/**
 * Single source of truth for product categories (owner decision, stage 01).
 * Code and storage use `id`; only the UI displays `labelAr`. Do not hardcode
 * labels elsewhere — import from here. The stage-02 migration CHECK constraint
 * must list exactly these ids; a test guards that they stay in sync.
 */
export const PRODUCT_CATEGORIES = [
  { id: 'chocolate', labelAr: 'شيكولاتة', sortOrder: 1 },
  { id: 'candy', labelAr: 'كاندي', sortOrder: 2 },
  { id: 'wafers_biscuits', labelAr: 'ويفر وبسكويت', sortOrder: 3 },
  { id: 'snacks_nuts', labelAr: 'سناكس ومكسرات', sortOrder: 4 },
] as const;

export type ProductCategoryId = (typeof PRODUCT_CATEGORIES)[number]['id'];

export const PRODUCT_CATEGORY_IDS: readonly ProductCategoryId[] = PRODUCT_CATEGORIES.map((c) => c.id);

export function isProductCategoryId(value: unknown): value is ProductCategoryId {
  return typeof value === 'string' && (PRODUCT_CATEGORY_IDS as readonly string[]).includes(value);
}

export function categoryLabelAr(id: ProductCategoryId): string {
  const found = PRODUCT_CATEGORIES.find((c) => c.id === id);
  if (!found) throw new Error(`Unknown category id: ${String(id)}`);
  return found.labelAr;
}
