/**
 * In-memory count of administrator operations whose outcome is unresolved (sending, or unknown
 * after a lost response). Sign-out asks for confirmation while it is non-zero, because signing
 * out discards the kept key/payload needed for a same-key retry. Never persisted.
 */
let count = 0;
export function trackUnresolved(): () => void {
  count += 1;
  let released = false;
  return () => {
    if (!released) {
      released = true;
      count -= 1;
    }
  };
}
export const hasUnresolved = (): boolean => count > 0;
