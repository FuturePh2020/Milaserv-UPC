import type { CatalogProduct } from '../api/contracts.ts';
import type { CreateOrderPayload, OrderLinePayload } from '../api/endpoints.ts';

/**
 * Cart model (pure functions; no I/O). A cart line keeps the carton price and pieces-per-carton
 * the trader actually REVIEWED; these are sent as the expected values of POST /api/v1/orders, so
 * a changed price or packaging is refused by the server instead of being silently accepted.
 * Money is integer piasters (max 1e8 x 1e5 x 100 lines = 1e15 < 2^53, so Number is exact).
 */
export const MAX_LINES = 100;
export const MAX_CARTONS = 100_000;

export interface CartLine {
  productId: string;
  name: string;
  brand: string;
  categoryId: string;
  cartonPriceCents: number; // reviewed (expected) carton price
  packSize: number; // reviewed (expected) pieces per carton
  minimumCartons: number;
  cartons: number;
}

export interface Cart {
  lines: CartLine[];
}

export const EMPTY_CART: Cart = { lines: [] };

export type CartError = 'too_many_lines' | 'below_minimum' | 'above_maximum' | 'not_integer' | 'unavailable';

export function lineError(line: Pick<CartLine, 'cartons' | 'minimumCartons'>): CartError | null {
  if (!Number.isSafeInteger(line.cartons)) return 'not_integer';
  if (line.cartons < line.minimumCartons) return 'below_minimum';
  if (line.cartons > MAX_CARTONS) return 'above_maximum';
  return null;
}

/** Adds cartons of a product; if already present, increases the quantity and records the current terms as reviewed. */
export function addProduct(cart: Cart, product: CatalogProduct, cartons: number): { cart: Cart; error: CartError | null } {
  if (product.availability.status === 'out_of_stock') return { cart, error: 'unavailable' };
  const existing = cart.lines.find((l) => l.productId === product.id);
  if (!existing && cart.lines.length >= MAX_LINES) return { cart, error: 'too_many_lines' };
  const next: CartLine = {
    productId: product.id,
    name: product.name,
    brand: product.brand,
    categoryId: product.category.id,
    cartonPriceCents: product.cartonPriceCents,
    packSize: product.packSize,
    minimumCartons: product.minimumCartons,
    cartons: (existing?.cartons ?? 0) + cartons,
  };
  const error = lineError(next);
  if (error) return { cart, error };
  return { cart: { lines: existing ? cart.lines.map((l) => (l.productId === product.id ? next : l)) : [...cart.lines, next] }, error: null };
}

export function setCartons(cart: Cart, productId: string, cartons: number): Cart {
  return { lines: cart.lines.map((l) => (l.productId === productId ? { ...l, cartons } : l)) };
}

export function removeLine(cart: Cart, productId: string): Cart {
  return { lines: cart.lines.filter((l) => l.productId !== productId) };
}

export function lineTotalCents(line: CartLine): number {
  return line.cartonPriceCents * line.cartons;
}

/** Goods subtotal of the reviewed prices (an estimate; the server computes the order's amounts). */
export function subtotalCents(cart: Cart): number {
  const total = cart.lines.reduce((sum, l) => sum + lineTotalCents(l), 0);
  if (!Number.isSafeInteger(total)) throw new RangeError('cart subtotal out of range');
  return total;
}

export function cartIsValid(cart: Cart): boolean {
  return cart.lines.length > 0 && cart.lines.length <= MAX_LINES && cart.lines.every((l) => lineError(l) === null);
}

export function payloadLines(cart: Cart): OrderLinePayload[] {
  return cart.lines.map((l) => ({ productId: l.productId, cartons: l.cartons, expectedCartonPriceCents: l.cartonPriceCents, expectedPackSize: l.packSize }));
}

/**
 * Applies the server's current terms (from a PRICE_CHANGED / PACKAGING_CHANGED conflict) to the
 * cart ONLY after the trader accepted them; the next submission is a new payload with a new key.
 */
export function acceptCurrentTerms(cart: Cart, current: ReadonlyArray<{ productId: string; cartonPriceCents: number; packSize: number }>): Cart {
  const byId = new Map(current.map((c) => [c.productId, c]));
  return { lines: cart.lines.map((l) => (byId.has(l.productId) ? { ...l, cartonPriceCents: byId.get(l.productId)!.cartonPriceCents, packSize: byId.get(l.productId)!.packSize } : l)) };
}

/** Removes lines whose products the server reported as unavailable. */
export function removeLines(cart: Cart, productIds: ReadonlyArray<string>): Cart {
  const drop = new Set(productIds);
  return { lines: cart.lines.filter((l) => !drop.has(l.productId)) };
}

/** True when the cart still describes exactly the given submitted payload's lines. */
export function cartMatchesPayload(cart: Cart, payload: CreateOrderPayload): boolean {
  const a = payloadLines(cart);
  return a.length === payload.items.length && a.every((l, i) => JSON.stringify(l) === JSON.stringify(payload.items[i]));
}
