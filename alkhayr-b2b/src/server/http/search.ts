/**
 * Literal substring search for SQLite LIKE: %, _ and \ in user text are
 * escaped, so they match themselves. Use with `LIKE ? ESCAPE '\'`.
 * Matching policy: SQLite LIKE is case-insensitive for ASCII (Latin) letters
 * only; Arabic and other scripts match exactly as typed.
 */
export function likePattern(text: string): string {
  return `%${text.replace(/[\\%_]/g, (c) => `\\${c}`)}%`;
}
