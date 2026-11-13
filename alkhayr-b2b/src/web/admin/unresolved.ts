/**
 * Number of administrator operations whose outcome is unresolved (sending, or unknown after a lost
 * response), published by the shell's OperationCoordinator (admin/operations.tsx). Sign-out asks
 * for confirmation while it is non-zero, because signing out discards the kept key and payload
 * needed for a same-key retry. In memory only; never persisted.
 */
let count = 0;
export function setUnresolvedCount(n: number): void {
  count = Math.max(0, n);
}
export const hasUnresolved = (): boolean => count > 0;
