"use server";

// Thin Next.js persistence wrapper around cart.ts's pure logic (design.md
// does not mandate a cart persistence mechanism — see cart.ts's header for
// the reasoning). The cart lives in a plain, non-httpOnly-need cookie
// scoped to the browser session; guest checkout has no server-side session
// concept, so there is nothing else to key it by.
//
// Not covered by a dedicated Vitest test: `cookies()` is a Next.js
// request-scoped API that only resolves inside a real request/render
// (server action or Server Component); cart.ts's pure functions carry the
// actual "exact variant + qty" behavior under test (task 4.3). This file's
// correctness is exercised functionally through the checkout flow (task
// 4.5/4.6's integration tests read/write the cart's item shape directly),
// through `/carrito`'s render tests (openspec/changes/carrito-completo
// tasks.md 1.3/1.4), and manually via `pnpm dev`.
//
// design.md D3: a Server Action that only writes a cookie does not trigger
// any re-render on its own — Next has no cookie-mutation detection. Every
// mutating action below calls `refresh()` (from "next/cache") so the
// header's cart badge and the current page re-render with the cart just
// written. `refresh()` sets `ActionDidRevalidateDynamicOnly`, unlike
// `revalidatePath("/", "layout")` which would purge the Full Route Cache
// for the whole store on every `+`/`−` click.
//
// `refresh()` must NEVER be added to `writeCart()` or `clearCart()`:
// `clearCart()` runs from the checkout Route Handler (design.md D4), and
// `revalidate.js` throws `E870` when called outside an action phase / from
// a `.../route` handler. Keep `refresh()` only in the exported mutating
// actions that run as Server Actions.

import { cookies } from "next/headers";
import { refresh } from "next/cache";
import { addItem, parseCart, removeItem, serializeCart, updateQty, type Cart } from "./cart";

const CART_COOKIE_NAME = "dominique_cart";
const CART_COOKIE_MAX_AGE_SECONDS = 60 * 60 * 24 * 7; // 7 days (was 30)

export async function getCart(): Promise<Cart> {
  const store = await cookies();
  return parseCart(store.get(CART_COOKIE_NAME)?.value);
}

async function writeCart(cart: Cart): Promise<void> {
  const store = await cookies();
  store.set(CART_COOKIE_NAME, serializeCart(cart), {
    httpOnly: true,
    sameSite: "lax",
    path: "/",
    maxAge: CART_COOKIE_MAX_AGE_SECONDS,
  });
}

/** Server Action: adds a variant/qty to the cart cookie. */
export async function addToCart(variantId: string, qty: number): Promise<Cart> {
  const cart = addItem(await getCart(), variantId, qty);
  await writeCart(cart);
  refresh();
  return cart;
}

/**
 * Single-arg Server Action wired directly to SizeSelector's
 * `onAddToCart(variantId: string)` prop (tasks.md 3.4 defined that
 * callback's shape; a Server Action passed as a Client Component prop must
 * match the exact parameter count Next.js expects to invoke it with).
 */
export async function addOneToCart(variantId: string): Promise<Cart> {
  return addToCart(variantId, 1);
}

/**
 * Server Action bound per-line in `/carrito` (design.md's CartLineControls
 * contract, `.bind(null, variantId)`). Delegates to `updateQty`'s existing
 * `qty <= 0 → removeItem` guard as a defensive server-side path — the
 * client stepper never lets qty reach 0 (spec: "Quantity cannot reach zero
 * via the stepper"; removal is the explicit "Eliminar" action instead).
 */
export async function updateCartQty(variantId: string, qty: number): Promise<void> {
  await writeCart(updateQty(await getCart(), variantId, qty));
  refresh();
}

/** Server Action bound per-line in `/carrito` for the explicit "Eliminar" action. */
export async function removeCartItem(variantId: string): Promise<void> {
  await writeCart(removeItem(await getCart(), variantId));
  refresh();
}

// clearCart() intentionally does NOT call refresh(): it runs from
// src/app/api/checkout/route.ts (a Route Handler, design.md D4), and
// refresh() throws E870 outside a Server Action's 'action' phase.
export async function clearCart(): Promise<void> {
  await writeCart([]);
}
