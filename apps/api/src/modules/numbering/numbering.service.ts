import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../core/prisma/prisma.service';
import { SettingsService } from '../settings/settings.service';

/**
 * Number Generator (ticketing spec §2). Formats are Settings values (ADR-008)
 * using {YYYY} and {SEQ:n} placeholders. Sequences are per (key, year) and the
 * increment is a single atomic upsert — safe under concurrent creation.
 */
@Injectable()
export class NumberingService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly settings: SettingsService,
  ) {}

  async next(settingKey: string, sequenceKey: string): Promise<string> {
    const format = String(await this.settings.resolve(settingKey));
    const year = new Date().getFullYear();

    const rows = await this.prisma.$queryRaw<{ lastValue: number }[]>`
      INSERT INTO "NumberSequence" ("key", "year", "lastValue")
      VALUES (${sequenceKey}, ${year}, 1)
      ON CONFLICT ("key", "year")
      DO UPDATE SET "lastValue" = "NumberSequence"."lastValue" + 1
      RETURNING "lastValue"
    `;
    const value = rows[0]?.lastValue;
    if (!value) throw new Error(`Sequence increment failed for ${sequenceKey}`);

    return format
      .replace('{YYYY}', String(year))
      .replace(/\{SEQ(?::(\d+))?\}/, (_m, width?: string) =>
        String(value).padStart(width ? Number(width) : 6, '0'),
      );
  }
}
