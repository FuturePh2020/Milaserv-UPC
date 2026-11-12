import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import type { CatalogProduct } from '../api/contracts.ts';
import { addProduct, EMPTY_CART, removeLine, setCartons, type Cart, type CartError } from './model.ts';
import { loadDraft, purgeOtherDrafts, saveDraft, type DraftScope, type PendingSubmission } from './storage.ts';

interface CartApi {
  cart: Cart;
  pending: PendingSubmission | null;
  add: (product: CatalogProduct, cartons: number) => CartError | null;
  setQuantity: (productId: string, cartons: number) => void;
  remove: (productId: string) => void;
  replace: (cart: Cart) => void;
  clear: () => void;
  setPending: (pending: PendingSubmission | null) => void;
  /** Order created: drop the pending submission and, if the cart still equals what was sent, the cart too. */
  complete: (clearCart: boolean) => void;
}

const CartContext = createContext<CartApi | null>(null);

/**
 * Cart state for ONE verified account (mounted with key = user+merchant, so another identity
 * always starts from its own draft and never sees this one).
 */
export function CartProvider({ scope, children }: { scope: DraftScope; children: ReactNode }) {
  const [draft, setDraft] = useState(() => {
    purgeOtherDrafts(scope);
    return loadDraft(scope);
  });
  useEffect(() => saveDraft(scope, draft), [scope, draft]);

  const api = useMemo<CartApi>(
    () => ({
      cart: draft.cart,
      pending: draft.pending,
      add: (product, cartons) => {
        const r = addProduct(draft.cart, product, cartons);
        if (!r.error) setDraft({ ...draft, cart: r.cart });
        return r.error;
      },
      setQuantity: (productId, cartons) => setDraft((d) => ({ ...d, cart: setCartons(d.cart, productId, cartons) })),
      remove: (productId) => setDraft((d) => ({ ...d, cart: removeLine(d.cart, productId) })),
      replace: (cart) => setDraft((d) => ({ ...d, cart })),
      clear: () => setDraft((d) => ({ ...d, cart: EMPTY_CART })),
      // Persisted synchronously BEFORE the caller sends the request, so a refresh during the request keeps the key and payload.
      setPending: (pending) => {
        const next = { ...draft, pending };
        saveDraft(scope, next);
        setDraft(next);
      },
      complete: (clearCart) => {
        const next = { cart: clearCart ? EMPTY_CART : draft.cart, pending: null };
        saveDraft(scope, next);
        setDraft(next);
      },
    }),
    [draft, scope],
  );
  return <CartContext.Provider value={api}>{children}</CartContext.Provider>;
}

export function useCart(): CartApi {
  const ctx = useContext(CartContext);
  if (!ctx) throw new Error('useCart must be used inside <CartProvider>');
  return ctx;
}
