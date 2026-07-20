import { PrismaClient } from '@prisma/client';
import { PrismaService } from '../src/core/prisma/prisma.service';
import { DrugCandidateGenerator } from '../src/modules/prescriptions/matching/candidates/drug-candidate-generator';
import type { MatchLimits } from '../src/modules/prescriptions/matching/match-config.service';
import { normalizeArabic, normalizeSearchInput } from '../src/modules/dic/normalization';
import { transliterateLatinToArabic } from '../src/modules/dic/normalization/transliteration';

const prisma = new PrismaClient();
const TAG = '9EMATCHCAND';
const LIMITS: MatchLimits = {
  maxCandidatesPerLine: 5,
  maxCandidatesPerStrategy: 10,
  minTrigramSimilarity: 0.3,
  maxInputTextLength: 200,
};

/**
 * CR-001 Phase 5 — DrugCandidateGenerator (design summary §6): the six
 * concrete generation strategies against real seeded DIC fixtures and
 * the real pg_trgm/GIN indexes, since this component's whole purpose is
 * targeted, indexed database queries — a pure-fixture unit test would
 * not exercise the thing being verified.
 */
describe('DrugCandidateGenerator (e2e)', () => {
  let generator: DrugCandidateGenerator;
  let exactNameDrugId: string;
  let aliasDrugId: string;
  let scientificDrugId: string;
  let transliterationDrugId: string;
  let fuzzyDrugId: string;
  let identifierDrugId: string;

  async function cleanup() {
    await prisma.drug.deleteMany({ where: { materialNo: { startsWith: TAG } } });
    await prisma.dosageForm.deleteMany({ where: { code: `${TAG}_TABLET` } });
    await prisma.manufacturer.deleteMany({ where: { nameEn: `${TAG} Pharma Co` } });
    await prisma.activeIngredient.deleteMany({ where: { scientificNameEn: `${TAG} Paracetamol` } });
  }

  beforeAll(async () => {
    await cleanup();
    const prismaService = new PrismaService();
    generator = new DrugCandidateGenerator(prismaService);

    const dosageForm = await prisma.dosageForm.create({
      data: {
        code: `${TAG}_TABLET`,
        nameEn: 'Match-Cand Tablet',
        nameAr: 'قرص',
        normalizedNameEn: 'match-cand tablet',
        normalizedNameAr: 'قرص',
      },
    });
    const manufacturer = await prisma.manufacturer.create({
      data: {
        nameEn: `${TAG} Pharma Co`,
        normalizedNameEn: normalizeSearchInput(`${TAG} Pharma Co`),
      },
    });
    const ingredient = await prisma.activeIngredient.create({
      data: {
        scientificNameEn: `${TAG} Paracetamol`,
        normalizedScientificNameEn: normalizeSearchInput(`${TAG} Paracetamol`),
        searchNameEn: normalizeSearchInput(`${TAG} Paracetamol`),
      },
    });

    // Level 1: exact identifier (barcode).
    const identifierDrug = await prisma.drug.create({
      data: {
        materialNo: `${TAG}1`,
        nameEn: `${TAG} IdentifierDrug`,
        barcode: '6281099998887',
        dosageFormId: dosageForm.id,
      },
    });
    identifierDrugId = identifierDrug.id;

    // Level 2: exact trade name — also reachable via fuzzy trigram
    // (real side effect), used below to verify EXACT_NAME wins dedupe.
    const exactNameText = `${TAG} ExactNameDrug`;
    const exactNameDrug = await prisma.drug.create({
      data: {
        materialNo: `${TAG}2`,
        nameEn: exactNameText,
        normalizedTradeNameEnglish: normalizeSearchInput(exactNameText),
        searchNameEnglish: normalizeSearchInput(exactNameText),
        combinedSearchText: normalizeSearchInput(exactNameText),
        dosageFormId: dosageForm.id,
        manufacturerId: manufacturer.id,
      },
    });
    exactNameDrugId = exactNameDrug.id;

    // Level 3: exact alias.
    const aliasDrug = await prisma.drug.create({
      data: { materialNo: `${TAG}3`, nameEn: `${TAG} AliasTargetDrug` },
    });
    aliasDrugId = aliasDrug.id;
    await prisma.drugAlias.create({
      data: {
        drugId: aliasDrug.id,
        alias: `${TAG} KnownAlias`,
        normalizedAlias: normalizeSearchInput(`${TAG} KnownAlias`),
        language: 'en',
        aliasType: 'COMMON_MISSPELLING',
        source: 'MANUAL',
        approved: false,
      },
    });

    // Level 4: exact scientific/ingredient name.
    const scientificDrug = await prisma.drug.create({
      data: { materialNo: `${TAG}4`, nameEn: `${TAG} ScientificMatchDrug` },
    });
    scientificDrugId = scientificDrug.id;
    await prisma.drugIngredient.create({
      data: { drugId: scientificDrug.id, activeIngredientId: ingredient.id },
    });

    // Level 5: transliteration — Arabic name equals the deterministic
    // transliteration of the Latin query, so the exact-match retry after
    // transliteration succeeds.
    const latinQuery = `${TAG}translit`;
    const transliteratedArabic = transliterateLatinToArabic(latinQuery);
    const transliterationDrug = await prisma.drug.create({
      data: {
        materialNo: `${TAG}5`,
        nameEn: `${TAG} TransliterationTargetDrug`,
        nameAr: transliteratedArabic,
        normalizedTradeNameArabic: normalizeArabic(transliteratedArabic),
      },
    });
    transliterationDrugId = transliterationDrug.id;

    // Level 6: fuzzy trigram only (deliberately misspelled relative to
    // the query used below, no exact-match column populated).
    const fuzzyDrug = await prisma.drug.create({
      data: {
        materialNo: `${TAG}6`,
        nameEn: `${TAG} FuzzyMatchDrug`,
        combinedSearchText: normalizeSearchInput(`${TAG} FuzzyMathDrug`),
      },
    });
    fuzzyDrugId = fuzzyDrug.id;
  });

  afterAll(async () => {
    await cleanup();
    await prisma.$disconnect();
  });

  it('finds a candidate by exact identifier (barcode)', async () => {
    const results = await generator.generate({
      nameText: '6281099998887',
      scientificText: null,
      limits: LIMITS,
    });
    const hit = results.find((r) => r.drug.drugId === identifierDrugId);
    expect(hit).toBeDefined();
    expect(hit!.matchSource).toBe('IDENTIFIER');
    expect(hit!.rawSimilarity).toBe(1);
  });

  it('finds a candidate by exact trade name and prefers EXACT_NAME over the fuzzy hit it would also produce', async () => {
    const results = await generator.generate({
      nameText: `${TAG} ExactNameDrug`,
      scientificText: null,
      limits: LIMITS,
    });
    const hit = results.find((r) => r.drug.drugId === exactNameDrugId);
    expect(hit).toBeDefined();
    expect(hit!.matchSource).toBe('EXACT_NAME');
    // Exactly one entry for this drug — the fuzzy strategy's own hit on
    // the same drug was deduped away, not appended as a second row.
    expect(results.filter((r) => r.drug.drugId === exactNameDrugId)).toHaveLength(1);
  });

  it('hydrates the candidate with dosage form and manufacturer', async () => {
    const results = await generator.generate({
      nameText: `${TAG} ExactNameDrug`,
      scientificText: null,
      limits: LIMITS,
    });
    const hit = results.find((r) => r.drug.drugId === exactNameDrugId)!;
    expect(hit.drug.dosageFormCode).toBe(`${TAG}_TABLET`);
    expect(hit.drug.manufacturerNameEn).toBe(`${TAG} Pharma Co`);
  });

  it('finds a candidate by exact alias and records approval state', async () => {
    const results = await generator.generate({
      nameText: `${TAG} KnownAlias`,
      scientificText: null,
      limits: LIMITS,
    });
    const hit = results.find((r) => r.drug.drugId === aliasDrugId);
    expect(hit).toBeDefined();
    expect(hit!.matchSource).toBe('EXACT_ALIAS');
    expect(hit!.matchedAliasApproved).toBe(false);
  });

  it('finds a candidate by exact scientific/ingredient name', async () => {
    const results = await generator.generate({
      nameText: 'irrelevant free text',
      scientificText: `${TAG} Paracetamol`,
      limits: LIMITS,
    });
    const hit = results.find((r) => r.drug.drugId === scientificDrugId);
    expect(hit).toBeDefined();
    expect(hit!.matchSource).toBe('EXACT_SCIENTIFIC');
  });

  it('also tries the drug-name text itself against scientific names (generic-name prescribing)', async () => {
    const results = await generator.generate({
      nameText: `${TAG} Paracetamol`,
      scientificText: null,
      limits: LIMITS,
    });
    const hit = results.find((r) => r.drug.drugId === scientificDrugId);
    expect(hit).toBeDefined();
    expect(hit!.matchSource).toBe('EXACT_SCIENTIFIC');
  });

  it('finds a candidate via transliteration when the exact-script match fails', async () => {
    const results = await generator.generate({
      nameText: `${TAG}translit`,
      scientificText: null,
      limits: LIMITS,
    });
    const hit = results.find((r) => r.drug.drugId === transliterationDrugId);
    expect(hit).toBeDefined();
    expect(hit!.matchSource).toBe('TRANSLITERATION');
  });

  it('finds a candidate via fuzzy trigram similarity for a misspelled query', async () => {
    const results = await generator.generate({
      nameText: `${TAG} FuzzyMatchDrug`,
      scientificText: null,
      limits: LIMITS,
    });
    const hit = results.find((r) => r.drug.drugId === fuzzyDrugId);
    expect(hit).toBeDefined();
    expect(hit!.matchSource).toBe('FUZZY_TRIGRAM');
    expect(hit!.rawSimilarity).toBeGreaterThan(0);
    expect(hit!.rawSimilarity).toBeLessThan(1);
  });

  it('never returns a fuzzy hit below the configured similarity threshold', async () => {
    const results = await generator.generate({
      nameText: 'completely unrelated gibberish text xyz',
      scientificText: null,
      limits: LIMITS,
    });
    expect(results.find((r) => r.drug.drugId === fuzzyDrugId)).toBeUndefined();
  });

  it('returns an empty array for null input text', async () => {
    const results = await generator.generate({
      nameText: null,
      scientificText: null,
      limits: LIMITS,
    });
    expect(results).toEqual([]);
  });
});
