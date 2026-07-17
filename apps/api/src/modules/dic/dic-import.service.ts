import { BadRequestException, Injectable } from '@nestjs/common';
import type { Prisma } from '@prisma/client';
import { PrismaService } from '../../core/prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import type { AuthUser } from '../auth/current-user.decorator';
import type { ImportCoverageDto, ImportDrugsDto } from './dic.dto';

/** Feed item types → catalog keys (spec H1). */
const ITEM_TYPE_MAP: Record<string, string> = {
  'normal item': 'NORMAL',
  'special item': 'SPECIAL',
  'special items': 'SPECIAL',
  'hospital at home': 'HOSPITAL_AT_HOME',
};

/** Headers that are NOT per-city availability columns (spec H6). */
const KNOWN_HEADERS = new Set([
  'Material',
  'Material Description',
  'Old material number',
  'EAN/UPC',
  'AR',
  'RSP',
  'Tax',
  'RSP_with_Tax',
  'Brand',
  'Division',
  'Category',
  'Sub_Category',
  'Class',
  'Sub_Class',
  'SFDA CODE',
  'GTIN',
  'eena CODE',
  'Meena Name',
  'Meena Coverage',
  'Note',
  'Item Type',
  'Raqeep',
  'Med. Coverage',
  'Item Type_1',
  'Meena Sales',
  'Acute / Chronic',
  'Combined Products',
  'Modified Stock',
  'Area Stock',
  'Normalization Factor',
  '__EMPTY',
  // Sheet2 (Hospital At Home) reduced columns
  'CODE',
  'NAME',
]);

const MAPPED_PRODUCT_COLUMNS = Array.from({ length: 22 }, (_, i) => `Mapped Product ${i + 1}`);
for (const c of MAPPED_PRODUCT_COLUMNS) KNOWN_HEADERS.add(c);

const str = (v: unknown): string | null => {
  const s = String(v ?? '').trim();
  return s ? s : null;
};
const num = (v: unknown): number | null => {
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
};

interface NormalizedDrug {
  index: number;
  materialNo: string | null;
  data: Omit<Prisma.DrugCreateManyInput, 'materialNo'>;
  alternatives: string[];
  crossSells: string[];
  meenaCovered: boolean | null;
  tawuniyaCovered: boolean | null;
  status: 'VALID' | 'INVALID';
  reason?: string;
}

/**
 * §15 drug master import — canonical feed: the company's Mapping export
 * (spec H1/H2). Chunked master-data upsert by Material number; per-row
 * rejections and §26 quality counts, never silent drops.
 */
@Injectable()
export class DicImportService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  normalize(rows: Record<string, unknown>[]): NormalizedDrug[] {
    const seen = new Set<string>();
    return rows.map((r, index) => {
      const materialNo = str(r['Material']) ?? str(r['CODE']);
      const nameEn = str(r['Material Description']) ?? str(r['NAME']);
      const sfdaCode = str(r['SFDA CODE']);
      const rawType = str(r['Item Type']);
      const meena = str(r['Meena Coverage']);
      const med = str(r['Med. Coverage']);

      const alternatives = MAPPED_PRODUCT_COLUMNS.map((c) => str(r[c])).filter(
        (v): v is string => v !== null,
      );
      const crossSells = (str(r['Combined Products']) ?? '')
        .split(/[,;\s]+/)
        .map((x) => x.trim())
        .filter(Boolean);

      // Any unknown numeric column is a per-city stock figure (spec H6).
      const availability: Record<string, number> = {};
      for (const [key, value] of Object.entries(r)) {
        if (KNOWN_HEADERS.has(key)) continue;
        const qty = num(value);
        if (qty !== null && String(value).trim() !== '') availability[key] = qty;
      }

      const row: NormalizedDrug = {
        index,
        materialNo,
        data: {
          oldMaterialNo: str(r['Old material number']),
          ean: str(r['EAN/UPC']),
          gtin: str(r['GTIN']),
          sfdaCode,
          coded: Boolean(sfdaCode), // §15.2 Coded/Not Coded (spec H4)
          nameEn: nameEn ?? '',
          nameAr: str(r['AR']),
          brand: str(r['Brand']),
          division: str(r['Division']),
          category: str(r['Category']),
          subCategory: str(r['Sub_Category']),
          className: str(r['Class']),
          subClassName: str(r['Sub_Class']),
          price: num(r['RSP']),
          priceWithTax: num(r['RSP_with_Tax']),
          itemTypeKey: rawType ? (ITEM_TYPE_MAP[rawType.toLowerCase()] ?? null) : null,
          raqeeb: (str(r['Raqeep']) ?? '').toLowerCase() === 'raqeeb',
          acuteChronic: str(r['Acute / Chronic']),
          note: str(r['Note']),
          availability: Object.keys(availability).length ? availability : undefined,
        },
        alternatives,
        crossSells,
        meenaCovered: meena ? meena.toLowerCase() === 'covered' : null,
        tawuniyaCovered: med ? med === 'Taw.Covered' : null,
        status: 'VALID',
      };

      if (!materialNo) {
        row.status = 'INVALID';
        row.reason = 'Missing Material number';
      } else if (!nameEn) {
        row.status = 'INVALID';
        row.reason = 'Missing name';
      } else if (seen.has(materialNo)) {
        row.status = 'INVALID';
        row.reason = `Duplicate material in chunk: ${materialNo}`;
      } else {
        seen.add(materialNo);
      }
      return row;
    });
  }

  /** One chunk (≤2000 rows): upsert master + rebuild links (spec H2). */
  async importChunk(actor: AuthUser, dto: ImportDrugsDto, meta: { ip?: string }) {
    const rows = this.normalize(dto.rows);
    const valid = rows.filter((r) => r.status === 'VALID');
    const materials = valid.map((r) => r.materialNo as string);

    const existing = new Map(
      (
        await this.prisma.drug.findMany({
          where: { materialNo: { in: materials } },
          select: { id: true, materialNo: true },
        })
      ).map((d) => [d.materialNo, d.id]),
    );

    // Fast path: new rows in one createMany.
    const fresh = valid.filter((r) => !existing.has(r.materialNo as string));
    if (fresh.length) {
      await this.prisma.drug.createMany({
        data: fresh.map((r) => ({ materialNo: r.materialNo as string, ...r.data })),
        skipDuplicates: true,
      });
    }
    // Monthly re-import path: update existing in place (spec H1).
    for (const r of valid) {
      const id = existing.get(r.materialNo as string);
      if (id) await this.prisma.drug.update({ where: { id }, data: r.data });
    }

    const drugs = await this.prisma.drug.findMany({
      where: { materialNo: { in: materials } },
      select: { id: true, materialNo: true },
    });
    const idByMaterial = new Map(drugs.map((d) => [d.materialNo, d.id]));
    const ids = drugs.map((d) => d.id);

    // Rebuild links for this chunk's drugs.
    await this.prisma.drugAlternative.deleteMany({ where: { drugId: { in: ids } } });
    await this.prisma.drugCrossSell.deleteMany({ where: { drugId: { in: ids } } });
    await this.prisma.drugCoverage.deleteMany({
      where: { drugId: { in: ids }, companyKey: { in: ['MEENA', 'TAWUNIYA'] } },
    });

    const altData: Prisma.DrugAlternativeCreateManyInput[] = [];
    const crossData: Prisma.DrugCrossSellCreateManyInput[] = [];
    const coverData: Prisma.DrugCoverageCreateManyInput[] = [];
    for (const r of valid) {
      const drugId = idByMaterial.get(r.materialNo as string);
      if (!drugId) continue;
      r.alternatives.forEach((altMaterialNo, order) => {
        altData.push({ drugId, altMaterialNo, order });
      });
      for (const materialNo of new Set(r.crossSells)) {
        crossData.push({ drugId, materialNo });
      }
      if (r.meenaCovered !== null) {
        coverData.push({ drugId, companyKey: 'MEENA', covered: r.meenaCovered });
      }
      if (r.tawuniyaCovered !== null) {
        coverData.push({ drugId, companyKey: 'TAWUNIYA', covered: r.tawuniyaCovered });
      }
    }
    if (altData.length) {
      await this.prisma.drugAlternative.createMany({ data: altData, skipDuplicates: true });
    }
    if (crossData.length) {
      await this.prisma.drugCrossSell.createMany({ data: crossData, skipDuplicates: true });
    }
    if (coverData.length) {
      await this.prisma.drugCoverage.createMany({ data: coverData, skipDuplicates: true });
    }

    await this.audit.record({
      actorId: actor.userId,
      actorEmail: actor.email,
      action: 'dic.import_chunk',
      entityType: 'drug',
      after: {
        fileName: dto.fileName,
        created: fresh.length,
        updated: valid.length - fresh.length,
        invalid: rows.length - valid.length,
      },
      ...meta,
    });

    return {
      created: fresh.length,
      updated: valid.length - fresh.length,
      invalid: rows
        .filter((r) => r.status === 'INVALID')
        .map(({ index, materialNo, reason }) => ({ index, materialNo, reason })),
      quality: {
        missingArabicName: valid.filter((r) => !r.data.nameAr).length,
        notCoded: valid.filter((r) => !r.data.coded).length,
      },
    };
  }

  /** §15.3 per-company coverage mapping bulk import (spec H3). */
  async importCoverage(actor: AuthUser, dto: ImportCoverageDto, meta: { ip?: string }) {
    const company = await this.prisma.insuranceCompany.findUnique({
      where: { key: dto.companyKey },
    });
    if (!company || !company.active) {
      throw new BadRequestException(`Unknown insurance company: ${dto.companyKey}`);
    }

    const materials = dto.rows.map((r) => r.material);
    const drugs = new Map(
      (
        await this.prisma.drug.findMany({
          where: { materialNo: { in: materials } },
          select: { id: true, materialNo: true },
        })
      ).map((d) => [d.materialNo, d.id]),
    );

    let applied = 0;
    const rejected: { index: number; reason: string }[] = [];
    const ids: string[] = [];
    const data: Prisma.DrugCoverageCreateManyInput[] = [];
    for (const [index, row] of dto.rows.entries()) {
      const drugId = drugs.get(row.material);
      if (!drugId) {
        rejected.push({ index, reason: `Unknown material: ${row.material}` });
        continue;
      }
      ids.push(drugId);
      data.push({ drugId, companyKey: dto.companyKey, covered: row.covered });
      applied++;
    }
    await this.prisma.drugCoverage.deleteMany({
      where: { drugId: { in: ids }, companyKey: dto.companyKey },
    });
    if (data.length) {
      await this.prisma.drugCoverage.createMany({ data, skipDuplicates: true });
    }

    await this.audit.record({
      actorId: actor.userId,
      actorEmail: actor.email,
      action: 'dic.coverage_import',
      entityType: 'drug_coverage',
      after: { companyKey: dto.companyKey, applied, rejected: rejected.length },
      ...meta,
    });
    return { applied, rejected };
  }
}
