import { selectSplitPlan } from './split-plan-selector';
import type { SplitCandidateBranch } from './split-plan-selector';

describe('selectSplitPlan', () => {
  it('picks the single branch that covers everything when one exists', () => {
    const candidates: SplitCandidateBranch[] = [
      { branchId: 'b1', score: 80, availableItemIds: new Set(['i1', 'i2']) },
      { branchId: 'b2', score: 90, availableItemIds: new Set(['i1']) },
    ];
    const result = selectSplitPlan(candidates, ['i1', 'i2'], 3);
    expect(result).toEqual([{ branchId: 'b1', itemIds: ['i1', 'i2'] }]);
  });

  it('combines two branches when no single branch covers everything', () => {
    const candidates: SplitCandidateBranch[] = [
      { branchId: 'b1', score: 80, availableItemIds: new Set(['i1']) },
      { branchId: 'b2', score: 70, availableItemIds: new Set(['i2']) },
    ];
    const result = selectSplitPlan(candidates, ['i1', 'i2'], 3);
    expect(result).toHaveLength(2);
    expect(result.flatMap((r) => r.itemIds).sort()).toEqual(['i1', 'i2']);
  });

  it('prefers the branch covering more items at each greedy step', () => {
    const candidates: SplitCandidateBranch[] = [
      { branchId: 'covers-two', score: 50, availableItemIds: new Set(['i1', 'i2']) },
      { branchId: 'covers-one', score: 99, availableItemIds: new Set(['i1']) },
    ];
    const result = selectSplitPlan(candidates, ['i1', 'i2'], 3);
    expect(result[0]!.branchId).toBe('covers-two');
  });

  it('breaks ties on equal coverage by preferring the higher-scoring branch', () => {
    const candidates: SplitCandidateBranch[] = [
      { branchId: 'lower', score: 40, availableItemIds: new Set(['i1']) },
      { branchId: 'higher', score: 90, availableItemIds: new Set(['i1']) },
    ];
    const result = selectSplitPlan(candidates, ['i1'], 3);
    expect(result[0]!.branchId).toBe('higher');
  });

  it('stops at maxBranches even if items remain uncovered', () => {
    const candidates: SplitCandidateBranch[] = [
      { branchId: 'b1', score: 90, availableItemIds: new Set(['i1']) },
      { branchId: 'b2', score: 80, availableItemIds: new Set(['i2']) },
      { branchId: 'b3', score: 70, availableItemIds: new Set(['i3']) },
    ];
    const result = selectSplitPlan(candidates, ['i1', 'i2', 'i3'], 2);
    expect(result).toHaveLength(2);
  });

  it('returns an empty assignment list when no candidate covers anything', () => {
    const candidates: SplitCandidateBranch[] = [{ branchId: 'b1', score: 90, availableItemIds: new Set() }];
    expect(selectSplitPlan(candidates, ['i1'], 3)).toEqual([]);
  });
});
