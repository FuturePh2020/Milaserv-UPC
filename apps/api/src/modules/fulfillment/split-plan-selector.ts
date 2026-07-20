export interface SplitCandidateBranch {
  branchId: string;
  score: number;
  /** fulfillmentRequestItemId set this branch can supply as AVAILABLE. */
  availableItemIds: Set<string>;
}

export interface SplitAssignment {
  branchId: string;
  itemIds: string[];
}

/**
 * Phase 6 §20 — bounded greedy set-cover, not exhaustive combinatorial
 * search (§20: minimize branch count first). At each step, picks the
 * not-yet-chosen branch covering the most still-uncovered items,
 * breaking ties by score. Stops at maxBranches or once nothing new is
 * covered — a documented simplification over a true optimal solver,
 * proportionate to this phase's foundation scope.
 */
export function selectSplitPlan(
  candidates: SplitCandidateBranch[],
  requiredItemIds: string[],
  maxBranches: number,
): SplitAssignment[] {
  const uncovered = new Set(requiredItemIds);
  const remaining = [...candidates];
  const assignments: SplitAssignment[] = [];

  while (uncovered.size > 0 && assignments.length < maxBranches && remaining.length > 0) {
    let best: { branch: SplitCandidateBranch; newItems: string[] } | null = null;
    for (const branch of remaining) {
      const newItems = [...uncovered].filter((id) => branch.availableItemIds.has(id));
      if (newItems.length === 0) continue;
      if (
        !best ||
        newItems.length > best.newItems.length ||
        (newItems.length === best.newItems.length && branch.score > best.branch.score)
      ) {
        best = { branch, newItems };
      }
    }
    if (!best) break;

    assignments.push({ branchId: best.branch.branchId, itemIds: best.newItems });
    for (const id of best.newItems) uncovered.delete(id);
    const idx = remaining.indexOf(best.branch);
    remaining.splice(idx, 1);
  }

  return assignments;
}
