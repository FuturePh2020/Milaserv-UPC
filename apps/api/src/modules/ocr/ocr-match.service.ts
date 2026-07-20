import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../core/prisma/prisma.service';
import { AiGatewayService } from '../ai/ai-gateway.service';

export interface MatchResult {
  drugId: string;
  score: number;
}

/**
 * Deterministic drug-master matcher (OCR spec I3): exact → starts-with →
 * contains → longest-token, with a transparent score per tier. When the
 * §2.1 AI gate is open, lines no tier could match are offered to the AI
 * gateway (spec K3) — with the deterministic result always taking
 * precedence and unmatched as the safe fallback.
 */
@Injectable()
export class OcrMatchService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly ai: AiGatewayService,
  ) {}

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

    return this.aiAssist(q);
  }

  /** K3: last resort only, behind the policy gate; score 0.6 keeps the
   *  suggestion below human-confirmed tiers — review stays mandatory (I4). */
  private async aiAssist(q: string): Promise<MatchResult | null> {
    if (!(await this.ai.gateOpen())) return null;

    // Candidate shortlist: any token ≥3 chars, top 10 by name.
    const tokens = q.split(' ').filter((t) => t.length >= 3);
    const candidates = tokens.length
      ? await this.prisma.drug.findMany({
          where: {
            OR: tokens.flatMap((t) => [
              { nameEn: { contains: t, mode: 'insensitive' as const } },
              { brand: { contains: t, mode: 'insensitive' as const } },
            ]),
          },
          select: { materialNo: true, nameEn: true },
          orderBy: { nameEn: 'asc' },
          take: 10,
        })
      : [];

    const result = (await this.ai.invoke('ocr.match', { text: q, candidates })) as {
      materialNo?: string;
    } | null;
    if (!result?.materialNo) return null;

    // Only a real master row can become a match — never trust free text.
    const drug = await this.prisma.drug.findUnique({
      where: { materialNo: String(result.materialNo) },
      select: { id: true },
    });
    return drug ? { drugId: drug.id, score: 0.6 } : null;
  }
}
