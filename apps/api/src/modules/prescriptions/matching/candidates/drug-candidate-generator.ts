import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../../../core/prisma/prisma.service';
import { normalizeSearchInput } from '../../../dic/normalization';
import {
  transliterateArabicToLatin,
  transliterateLatinToArabic,
} from '../../../dic/normalization/transliteration';
import type { MatchLimits } from '../match-config.service';
import type { CandidateDrugDto, CandidateMatchSource, RawCandidate } from './types';

const ARABIC_BLOCK = /[؀-ۿ]/;
const IDENTIFIER_PATTERN = /^[0-9][0-9-]{5,}$/;

interface StrategyHit {
  drugId: string;
  matchSource: CandidateMatchSource;
  rawSimilarity: number;
  matchedText: string;
  matchedAliasApproved: boolean | null;
}

/** Priority order — an earlier strategy's hit for a given drug always
 *  wins over a later one's when the same drug surfaces twice (design
 *  summary §6: exact identifier/name/alias/scientific outrank fuzzy). */
const STRATEGY_PRIORITY: CandidateMatchSource[] = [
  'IDENTIFIER',
  'EXACT_NAME',
  'EXACT_ALIAS',
  'EXACT_SCIENTIFIC',
  'TRANSLITERATION',
  'FUZZY_TRIGRAM',
];

/**
 * CR-001 Phase 5 — candidate generation (design summary §6). Runs the
 * six concrete strategies (identifier / exact name / exact alias /
 * exact scientific / transliteration / fuzzy trigram) and returns a
 * deduplicated, hydrated candidate list. Never compares every OCR
 * string against every drug record in application memory — every
 * strategy is a targeted, indexed database query (pg_trgm GIN indexes
 * for the fuzzy strategy, unique/normal indexes for the exact ones).
 * Caps are applied per-strategy here (limits.maxCandidatesPerStrategy);
 * the final per-line cap (limits.maxCandidatesPerLine) is applied by
 * the Step 4 orchestrator after scoring, not here.
 */
@Injectable()
export class DrugCandidateGenerator {
  constructor(private readonly prisma: PrismaService) {}

  async generate(params: {
    nameText: string | null;
    scientificText: string | null;
    limits: MatchLimits;
  }): Promise<RawCandidate[]> {
    const { nameText, scientificText, limits } = params;
    if (!nameText) return [];

    const hits: StrategyHit[] = [];
    hits.push(...(await this.lookupIdentifier(nameText)));
    hits.push(...(await this.lookupExactName(nameText)));
    hits.push(...(await this.lookupExactAlias(nameText)));
    hits.push(...(await this.lookupExactScientific(nameText, scientificText)));
    hits.push(...(await this.lookupTransliteration(nameText)));
    hits.push(...(await this.lookupFuzzy(nameText, scientificText, limits)));

    const bestPerDrug = this.dedupe(hits);
    return this.hydrate(bestPerDrug);
  }

  private dedupe(hits: StrategyHit[]): StrategyHit[] {
    const byDrug = new Map<string, StrategyHit>();
    for (const hit of hits) {
      const existing = byDrug.get(hit.drugId);
      if (!existing) {
        byDrug.set(hit.drugId, hit);
        continue;
      }
      const existingRank = STRATEGY_PRIORITY.indexOf(existing.matchSource);
      const hitRank = STRATEGY_PRIORITY.indexOf(hit.matchSource);
      if (hitRank < existingRank) byDrug.set(hit.drugId, hit);
    }
    return [...byDrug.values()];
  }

  // ── Level 1: exact identifier (barcode / materialNo / gtin / ean / sfdaCode) ──

  private async lookupIdentifier(nameText: string): Promise<StrategyHit[]> {
    const cleaned = nameText.trim();
    if (!IDENTIFIER_PATTERN.test(cleaned)) return [];
    const rows = await this.prisma.drug.findMany({
      where: {
        mergedIntoDrugId: null,
        OR: [
          { barcode: cleaned },
          { materialNo: cleaned },
          { gtin: cleaned },
          { ean: cleaned },
          { sfdaCode: cleaned },
        ],
      },
      select: { id: true },
      take: 5,
    });
    return rows.map((r) => ({
      drugId: r.id,
      matchSource: 'IDENTIFIER' as const,
      rawSimilarity: 1,
      matchedText: cleaned,
      matchedAliasApproved: null,
    }));
  }

  // ── Level 2: exact primary trade name ──

  private async lookupExactName(nameText: string): Promise<StrategyHit[]> {
    const normalized = normalizeSearchInput(nameText);
    if (!normalized) return [];
    const rows = await this.prisma.drug.findMany({
      where: {
        mergedIntoDrugId: null,
        OR: [{ normalizedTradeNameEnglish: normalized }, { normalizedTradeNameArabic: normalized }],
      },
      select: { id: true, nameEn: true },
      take: 5,
    });
    return rows.map((r) => ({
      drugId: r.id,
      matchSource: 'EXACT_NAME' as const,
      rawSimilarity: 1,
      matchedText: r.nameEn,
      matchedAliasApproved: null,
    }));
  }

  // ── Level 3: exact alias ──

  private async lookupExactAlias(nameText: string): Promise<StrategyHit[]> {
    const normalized = normalizeSearchInput(nameText);
    if (!normalized) return [];
    const rows = await this.prisma.drugAlias.findMany({
      where: { normalizedAlias: normalized, active: true },
      select: { drugId: true, alias: true, approved: true },
      take: 5,
    });
    return rows.map((r) => ({
      drugId: r.drugId,
      matchSource: 'EXACT_ALIAS' as const,
      rawSimilarity: 1,
      matchedText: r.alias,
      matchedAliasApproved: r.approved,
    }));
  }

  // ── Level 4: exact scientific/ingredient name ──

  private async lookupExactScientific(
    nameText: string,
    scientificText: string | null,
  ): Promise<StrategyHit[]> {
    const candidates = [scientificText, nameText].filter(
      (v): v is string => v !== null && v.trim().length > 0,
    );
    const hits: StrategyHit[] = [];
    for (const text of candidates) {
      const normalized = normalizeSearchInput(text);
      if (!normalized) continue;
      const rows = await this.prisma.drugIngredient.findMany({
        where: {
          active: true,
          activeIngredient: {
            OR: [
              { normalizedScientificNameEn: normalized },
              { normalizedScientificNameAr: normalized },
            ],
          },
        },
        select: { drugId: true, activeIngredient: { select: { scientificNameEn: true } } },
        take: 5,
      });
      for (const r of rows) {
        hits.push({
          drugId: r.drugId,
          matchSource: 'EXACT_SCIENTIFIC',
          rawSimilarity: 1,
          matchedText: r.activeIngredient.scientificNameEn,
          matchedAliasApproved: null,
        });
      }
    }
    return hits;
  }

  // ── Level 5: transliteration (best-effort, never authoritative) ──

  private async lookupTransliteration(nameText: string): Promise<StrategyHit[]> {
    const transliterated = ARABIC_BLOCK.test(nameText)
      ? transliterateArabicToLatin(nameText)
      : transliterateLatinToArabic(nameText);
    const normalized = normalizeSearchInput(transliterated);
    if (!normalized) return [];

    const [nameRows, aliasRows] = await Promise.all([
      this.prisma.drug.findMany({
        where: {
          mergedIntoDrugId: null,
          OR: [
            { normalizedTradeNameEnglish: normalized },
            { normalizedTradeNameArabic: normalized },
          ],
        },
        select: { id: true, nameEn: true },
        take: 5,
      }),
      this.prisma.drugAlias.findMany({
        where: { normalizedAlias: normalized, active: true },
        select: { drugId: true, alias: true },
        take: 5,
      }),
    ]);

    return [
      ...nameRows.map((r) => ({
        drugId: r.id,
        matchSource: 'TRANSLITERATION' as const,
        rawSimilarity: 1,
        matchedText: r.nameEn,
        matchedAliasApproved: null,
      })),
      ...aliasRows.map((r) => ({
        drugId: r.drugId,
        matchSource: 'TRANSLITERATION' as const,
        rawSimilarity: 1,
        matchedText: r.alias,
        matchedAliasApproved: null,
      })),
    ];
  }

  // ── Level 6: fuzzy pg_trgm similarity — always a GIN-indexed, threshold-
  // bounded query against an already-narrow column set, never a full scan. ──

  private async lookupFuzzy(
    nameText: string,
    scientificText: string | null,
    limits: MatchLimits,
  ): Promise<StrategyHit[]> {
    const normalizedName = normalizeSearchInput(nameText);
    const threshold = limits.minTrigramSimilarity;
    const take = limits.maxCandidatesPerStrategy;
    if (!normalizedName) return [];

    const queries: Promise<StrategyHit[]>[] = [
      this.prisma.$queryRaw<{ id: string; matchedtext: string; sim: number }[]>`
          SELECT id, "nameEn" AS matchedtext, similarity("combinedSearchText", ${normalizedName}) AS sim
          FROM "Drug"
          WHERE "mergedIntoDrugId" IS NULL
            AND "combinedSearchText" IS NOT NULL
            AND similarity("combinedSearchText", ${normalizedName}) > ${threshold}
          ORDER BY sim DESC
          LIMIT ${take}
        `.then((rows) =>
        rows.map((r) => ({
          drugId: r.id,
          matchSource: 'FUZZY_TRIGRAM' as const,
          rawSimilarity: Number(r.sim),
          matchedText: r.matchedtext,
          matchedAliasApproved: null,
        })),
      ),
      this.prisma.$queryRaw<
        { drugid: string; matchedtext: string; approved: boolean; sim: number }[]
      >`
          SELECT "drugId" AS drugid, alias AS matchedtext, approved, similarity("normalizedAlias", ${normalizedName}) AS sim
          FROM "DrugAlias"
          WHERE active = true
            AND similarity("normalizedAlias", ${normalizedName}) > ${threshold}
          ORDER BY sim DESC
          LIMIT ${take}
        `.then((rows) =>
        rows.map((r) => ({
          drugId: r.drugid,
          matchSource: 'FUZZY_TRIGRAM' as const,
          rawSimilarity: Number(r.sim),
          matchedText: r.matchedtext,
          matchedAliasApproved: r.approved,
        })),
      ),
    ];

    const normalizedScientific = scientificText ? normalizeSearchInput(scientificText) : null;
    if (normalizedScientific) {
      queries.push(
        this.prisma.$queryRaw<{ drugid: string; matchedtext: string; sim: number }[]>`
            SELECT di."drugId" AS drugid, ai."scientificNameEn" AS matchedtext,
                   similarity(ai."normalizedScientificNameEn", ${normalizedScientific}) AS sim
            FROM "ActiveIngredient" ai
            JOIN "DrugIngredient" di ON di."activeIngredientId" = ai.id
            WHERE di.active = true
              AND similarity(ai."normalizedScientificNameEn", ${normalizedScientific}) > ${threshold}
            ORDER BY sim DESC
            LIMIT ${take}
          `.then((rows) =>
          rows.map((r) => ({
            drugId: r.drugid,
            matchSource: 'FUZZY_TRIGRAM' as const,
            rawSimilarity: Number(r.sim),
            matchedText: r.matchedtext,
            matchedAliasApproved: null,
          })),
        ),
      );
    }

    const results = await Promise.all(queries);
    const flat = results.flat();

    // A drug found via more than one fuzzy column keeps its best
    // similarity, not an arbitrary one.
    const bestByDrug = new Map<string, StrategyHit>();
    for (const hit of flat) {
      const existing = bestByDrug.get(hit.drugId);
      if (!existing || hit.rawSimilarity > existing.rawSimilarity) {
        bestByDrug.set(hit.drugId, hit);
      }
    }
    return [...bestByDrug.values()];
  }

  // ── Hydration: one bulk fetch for every deduped drug id ──

  private async hydrate(hits: StrategyHit[]): Promise<RawCandidate[]> {
    if (hits.length === 0) return [];
    const ids = hits.map((h) => h.drugId);
    const drugs = await this.prisma.drug.findMany({
      where: { id: { in: ids } },
      include: {
        dosageForm: { select: { code: true } },
        manufacturer: { select: { nameEn: true } },
        strengthComponents: {
          select: {
            numeratorValue: true,
            numeratorUnit: { select: { code: true } },
            denominatorValue: true,
            denominatorUnit: { select: { code: true } },
            sequence: true,
          },
          orderBy: { sequence: 'asc' },
        },
        ingredients: {
          where: { active: true },
          select: { activeIngredient: { select: { scientificNameEn: true } } },
          orderBy: { sequence: 'asc' },
        },
      },
    });
    const byId = new Map(drugs.map((d) => [d.id, d]));

    const results: RawCandidate[] = [];
    for (const hit of hits) {
      const drug = byId.get(hit.drugId);
      if (!drug) continue; // merged/deleted between lookup and hydration
      const dto: CandidateDrugDto = {
        drugId: drug.id,
        materialNo: drug.materialNo,
        nameEn: drug.nameEn,
        nameAr: drug.nameAr,
        active: drug.active,
        discontinued: drug.discontinued,
        dataQualityStatus: drug.dataQualityStatus,
        dosageFormCode: drug.dosageForm?.code ?? null,
        manufacturerNameEn: drug.manufacturer?.nameEn ?? null,
        strengthText: drug.strengthText,
        structuredStrengths: drug.strengthComponents.map((s) => ({
          numeratorValue: s.numeratorValue !== null ? Number(s.numeratorValue) : null,
          numeratorUnitCode: s.numeratorUnit?.code ?? null,
          denominatorValue: s.denominatorValue !== null ? Number(s.denominatorValue) : null,
          denominatorUnitCode: s.denominatorUnit?.code ?? null,
          sequence: s.sequence,
        })),
        ingredientNamesEn: drug.ingredients.map((i) => i.activeIngredient.scientificNameEn),
      };
      results.push({
        drug: dto,
        matchSource: hit.matchSource,
        rawSimilarity: hit.rawSimilarity,
        matchedText: hit.matchedText,
        matchedAliasApproved: hit.matchedAliasApproved,
      });
    }
    return results;
  }
}
