/**
 * CR-001 Phase 5 — offline string similarity for the scorer (design
 * summary §7). DrugCandidateGenerator's FUZZY_TRIGRAM strategy already
 * measures real pg_trgm similarity() in Postgres for *finding*
 * candidates; this Dice-coefficient bigram similarity is a separate,
 * pure, no-DB metric the scorer uses to compare two already-fetched
 * strings (e.g. the extracted scientific name against a candidate's
 * ActiveIngredient name) without a second database round-trip.
 */

function bigrams(text: string): string[] {
  const normalized = text.toLowerCase().trim();
  if (normalized.length < 2) return normalized ? [normalized] : [];
  const result: string[] = [];
  for (let i = 0; i < normalized.length - 1; i++) {
    result.push(normalized.slice(i, i + 2));
  }
  return result;
}

/** Sorensen-Dice coefficient over character bigrams, 0-1. Symmetric,
 *  and 1.0 for two strings that normalize identically. */
export function bigramSimilarity(a: string, b: string): number {
  const na = a.toLowerCase().trim();
  const nb = b.toLowerCase().trim();
  if (!na || !nb) return 0;
  if (na === nb) return 1;

  const bigramsA = bigrams(na);
  const bigramsB = bigrams(nb);
  if (bigramsA.length === 0 || bigramsB.length === 0) return 0;

  const counts = new Map<string, number>();
  for (const bg of bigramsA) counts.set(bg, (counts.get(bg) ?? 0) + 1);

  let matches = 0;
  for (const bg of bigramsB) {
    const remaining = counts.get(bg) ?? 0;
    if (remaining > 0) {
      matches += 1;
      counts.set(bg, remaining - 1);
    }
  }
  return (2 * matches) / (bigramsA.length + bigramsB.length);
}
