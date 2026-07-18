import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../core/prisma/prisma.service';

export interface MatchResult {
  drugId: string;
  score: number;
}

/**
 * Deterministic drug-master matcher (OCR spec I3): exact → starts-with →
 * contains → longest-token, with a transparent score per tier. Fuzzy/AI
 * matching is the §23 "AI" upgrade behind this same interface.
 */
@Injectable()
export class OcrMatchService {
  constructor(private readonly prisma: PrismaService) {}

  async match(rawText: string): Promise<MatchResult | null> {
    const q = rawText.trim().replace(/\s+/g, ' ');
    if (!q) return null;
    const mode = 'insensitive' as const;
    const pick = { select: { id: true }, orderBy: { nameEn: 'asc' as const } };

    const exact = await this.prisma.drug.findFirst({
      where: {
        OR: [{ nameEn: { equals: q, mode } }, { nameAr: q }, { brand: { equals: q, mode } }],
      },
      ...pick,
    });
    if (exact) return { drugId: exact.id, score: 1 };

    const starts = await this.prisma.drug.findFirst({
      where: { OR: [{ nameEn: { startsWith: q, mode } }, { nameAr: { startsWith: q } }] },
      ...pick,
    });
    if (starts) return { drugId: starts.id, score: 0.9 };

    const contains = await this.prisma.drug.findFirst({
      where: { OR: [{ nameEn: { contains: q, mode } }, { nameAr: { contains: q } }] },
      ...pick,
    });
    if (contains) return { drugId: contains.id, score: 0.7 };

    const token = q
      .split(' ')
      .filter((t) => t.length >= 4)
      .sort((a, b) => b.length - a.length)[0];
    if (token) {
      const byToken = await this.prisma.drug.findFirst({
        where: {
          OR: [
            { nameEn: { contains: token, mode } },
            { nameAr: { contains: token } },
            { brand: { contains: token, mode } },
          ],
        },
        ...pick,
      });
      if (byToken) return { drugId: byToken.id, score: 0.5 };
    }
    return null;
  }
}
