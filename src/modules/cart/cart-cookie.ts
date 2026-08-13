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
// 4.5/4.6's integration tests read/write the cart's item shape directly)
// and manually via `pnpm dev`.

import { cookies } from "next/headers";
import { addItem, parseCart, serializeCart, type Cart } from "./cart";

const CART_COOKIE_NAME = "dominique_cart";
const CART_COOKIE_MAX_AGE_SECONDS = 60 * 60 * 24 * 30; // 30 days

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

export async function clearCart(): Promise<void> {
  await writeCart([]);
}
