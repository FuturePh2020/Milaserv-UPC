import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../core/prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import type { AuthUser } from '../auth/current-user.decorator';
import type { ImportBranchesDto } from './branches.dto';

/** Feed store types → §16.2 catalog keys (branch-center spec G4). */
const TYPE_MAP: Record<string, string> = {
  offline: 'OFFLINE_BRANCH',
  'online branch': 'ONLINE_STORE',
  'online meena branch': 'ONLINE_STORE',
  'meena branch': 'OFFLINE_BRANCH',
  'online dark store': 'DARK_STORE',
  'dark store': 'DARK_STORE',
  raqeeb: 'RAQEEB_BRANCH',
  'raqeeb branch': 'RAQEEB_BRANCH',
};

type QualityFlag = 'missing_location' | 'missing_supervisor' | 'unmapped_type';

interface NormalizedRow {
  index: number;
  code: string | null;
  data: {
    storeCode: string | null;
    nameAr: string;
    nameEn: string;
    branchTypeKey: string | null;
    deliveryCovered: boolean | null;
    districtManagerName: string | null;
    areaManagerName: string | null;
    supervisorName: string | null;
    addressEn: string | null;
    addressAr: string | null;
    mapUrl: string | null;
    city: string | null;
    district: string | null;
    region: string | null;
    postalCode: string | null;
    latitude: number | null;
    longitude: number | null;
    phone: string | null;
    phone2: string | null;
    phone3: string | null;
  };
  status: 'VALID' | 'INVALID';
  reason?: string;
  qualityFlags: QualityFlag[];
}

const str = (v: unknown): string | null => {
  const s = String(v ?? '').trim();
  return s ? s : null;
};
const num = (v: unknown): number | null => {
  const n = Number(v);
  return Number.isFinite(n) && n !== 0 ? n : null;
};

/**
 * §16.1 master-data import — canonical format: the company's United
 * Locations export (branch-center spec G2/G3). Upsert by code; rows are
 * validated and quality-flagged server-side, never silently dropped (§26).
 */
@Injectable()
export class BranchImportService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  normalize(rows: Record<string, unknown>[]): NormalizedRow[] {
    const seen = new Set<string>();
    return rows.map((r, index) => {
      const code = str(r['SAP Store Code']) ?? str(r['Store Code']);
      const nameEn = str(r['Pharmacy Name']);
      const rawType = str(r['Store Type']);
      const branchTypeKey = rawType ? (TYPE_MAP[rawType.toLowerCase()] ?? null) : null;
      const coverage = str(r['Delivery Coverage']);
      const latitude = num(r['Latitude']);
      const longitude = num(r['Longitude']);
      const supervisorName = str(r['Supervisor']);

      // No Arabic pharmacy-name column in the feed (G3): derive "المتحدة N"
      // from the English name's store number, else mirror the English name.
      const n = nameEn?.match(/\d+/)?.[0];
      const nameAr = n ? `المتحدة ${n}` : (nameEn ?? '');

      const row: NormalizedRow = {
        index,
        code,
        data: {
          storeCode: str(r['Store Code']),
          nameAr,
          nameEn: nameEn ?? '',
          branchTypeKey,
          deliveryCovered: coverage ? coverage.toLowerCase() === 'covered' : null,
          districtManagerName: str(r['District Manager']),
          areaManagerName: str(r['Area Manager']),
          supervisorName,
          addressEn: str(r['English Address']),
          addressAr: str(r['Arabic Address']),
          mapUrl: str(r['Location']),
          city: str(r['City']),
          district: str(r['District']),
          region: str(r['Region']),
          postalCode: str(r['Postal Code']),
          latitude,
          longitude,
          phone: str(r['Primary Phone']),
          phone2: str(r['Pharmacy Phone']),
          phone3: str(r['Another Phone']),
        },
        status: 'VALID',
        qualityFlags: [],
      };

      if (!code) {
        row.status = 'INVALID';
        row.reason = 'No SAP Store Code / Store Code';
        return row;
      }
      if (!nameEn) {
        row.status = 'INVALID';
        row.reason = 'Pharmacy Name is required';
        return row;
      }
      if (seen.has(code)) {
        row.status = 'INVALID';
        row.reason = `Duplicate code in file: ${code}`;
        return row;
      }
      seen.add(code);

      // §26 data-quality flags — imported anyway, surfaced for cleanup.
      if (latitude === null || longitude === null) row.qualityFlags.push('missing_location');
      if (!supervisorName) row.qualityFlags.push('missing_supervisor');
      if (!branchTypeKey) row.qualityFlags.push('unmapped_type');
      return row;
    });
  }

  async preview(dto: ImportBranchesDto) {
    const rows = this.normalize(dto.rows);
    const valid = rows.filter((r) => r.status === 'VALID');
    const codes = valid.map((r) => r.code as string);
    const existing = new Set(
      (
        await this.prisma.branch.findMany({
          where: { code: { in: codes } },
          select: { code: true },
        })
      ).map((b) => b.code),
    );
    return {
      counts: {
        valid: valid.length,
        invalid: rows.length - valid.length,
        willCreate: valid.filter((r) => !existing.has(r.code as string)).length,
        willUpdate: valid.filter((r) => existing.has(r.code as string)).length,
        missingLocation: valid.filter((r) => r.qualityFlags.includes('missing_location')).length,
        missingSupervisor: valid.filter((r) => r.qualityFlags.includes('missing_supervisor'))
          .length,
        unmappedType: valid.filter((r) => r.qualityFlags.includes('unmapped_type')).length,
      },
      rows: rows.map(({ index, code, status, reason, qualityFlags, data }) => ({
        index,
        code,
        nameEn: data.nameEn,
        region: data.region,
        status,
        reason,
        qualityFlags,
      })),
    };
  }

  /** Master-data upsert by code (spec G3): monthly re-imports update in place. */
  async import(actor: AuthUser, dto: ImportBranchesDto, meta: { ip?: string }) {
    const rows = this.normalize(dto.rows);
    const valid = rows.filter((r) => r.status === 'VALID');
    let created = 0;
    let updated = 0;

    for (const row of valid) {
      const code = row.code as string;
      const existing = await this.prisma.branch.findUnique({ where: { code } });
      if (existing) {
        await this.prisma.branch.update({
          where: { code },
          data: { ...row.data, deletedAt: null },
        });
        updated++;
      } else {
        await this.prisma.branch.create({ data: { code, ...row.data } });
        created++;
      }
    }

    await this.audit.record({
      actorId: actor.userId,
      actorEmail: actor.email,
      action: 'branch.import',
      entityType: 'branch',
      after: {
        fileName: dto.fileName,
        created,
        updated,
        invalid: rows.length - valid.length,
      },
      ...meta,
    });
    return {
      created,
      updated,
      invalid: rows
        .filter((r) => r.status === 'INVALID')
        .map(({ index, code, reason }) => ({ index, code, reason })),
    };
  }
}
