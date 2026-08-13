// Cart module — pure logic only, no DB/Prisma/cookies here (see cart-cookie.ts
// for the Next.js persistence wrapper). Backs specs/cart-checkout/spec.md:
//   - "Cart Holds Selected Variants" (the cart stores the specific variant
//     id + quantity selected, not just the product)
//
// design.md does not mandate a persistence mechanism for the cart. Since
// checkout is guest-only (no account/session concept beyond the browser),
// this module models the cart as a plain array of {variantId, qty} lines
// that a thin cookie wrapper serializes/deserializes per request — no new
// Cart/CartItem Prisma models, no server-side session store. Kept as pure
// functions so the "exact variant + qty" behavior is testable without a
// browser or a database.

export interface CartItem {
  variantId: string;
  qty: number;
}

export type Cart = CartItem[];

/**
 * Adds `qty` of `variantId` to the cart. If the variant is already present,
 * its quantity is incremented rather than creating a duplicate line — the
 * cart always shows exactly one line per variant (spec: "the cart SHALL
 * show that exact variant with quantity 1").
 */
export function addItem(cart: Cart, variantId: string, qty: number): Cart {
  if (!Number.isFinite(qty) || qty <= 0) return cart;

  const existing = cart.find((item) => item.variantId === variantId);
  if (existing) {
    return cart.map((item) =>
      item.variantId === variantId ? { ...item, qty: item.qty + qty } : item,
    );
  }
  return [...cart, { variantId, qty }];
}

/** Sets a line's quantity to an exact value; 0 or less removes the line. */
export function updateQty(cart: Cart, variantId: string, qty: number): Cart {
  if (!Number.isFinite(qty) || qty <= 0) return removeItem(cart, variantId);
  return cart.map((item) => (item.variantId === variantId ? { ...item, qty } : item));
}

export function removeItem(cart: Cart, variantId: string): Cart {
  return cart.filter((item) => item.variantId !== variantId);
}

export function serializeCart(cart: Cart): string {
  return JSON.stringify(cart);
}

function isValidCartItem(value: unknown): value is CartItem {
  return (
    typeof value === "object" &&
    value !== null &&
    typeof (value as Record<string, unknown>).variantId === "string" &&
    typeof (value as Record<string, unknown>).qty === "number" &&
    Number.isFinite((value as Record<string, unknown>).qty as number) &&
    ((value as Record<string, unknown>).qty as number) > 0
  );
}

/**
 * Parses a serialized cart (e.g. a cookie value). Any malformed, missing,
 * or tampered input degrades to an empty cart rather than throwing — a
 * corrupt cookie must never crash checkout.
 */
export function parseCart(raw: string | undefined | null): Cart {
  if (!raw) return [];
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return [];
  }
  if (!Array.isArray(parsed)) return [];
  return parsed.filter(isValidCartItem);
}
