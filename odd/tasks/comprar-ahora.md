# Feature: Buy Now ("Comprar ahora") on the product detail page

## Objective
Let a shopper buy a single product variant directly from the PDP without adding it to the cart first.

## Problem / Why
Today the only purchase path is PDP -> "Agregar al carrito" -> /carrito -> /checkout. `/checkout` always reads the cart cookie, and `POST /api/checkout` always calls `clearCart()` after creating the order.

## Scope (authorized)
- "Comprar ahora" button in `SizeSelector`, enabled only for a selected in-stock variant, qty 1 (DA-1: no quantity input on the PDP).
- `/checkout?variante=<variantId>` builds a single line (qty 1) from that variant and ignores the cart cookie.
- Buy-now orders must NOT clear the existing cart (confirmed by owner, 2026-09-27).
- Invalid, unknown, or out-of-stock variant -> no payment form (redirect away).
- Stock is still re-validated server-side on submit (unchanged `createPendingOrder`).

## Constraints
- Checkout stays guest-only; no new persistence.
- `clearCart()` must stay out of Server Action `refresh()` concerns (see cart-cookie.ts header).
- The buy-now flag only controls cart clearing; pricing and stock remain server-authoritative.

## TDD
- Mode: enabled. Source: `openspec/config.yaml` (`tdd: true`). Runner: `npm test` (vitest); e2e: `npm run test:e2e` (playwright).

## Delivery
- Branch: `feat/comprar-ahora` (from `main`). Strategy: `ask-on-risk`. Forecast: ~250 authored changed lines (under the 400 budget).

## Tasks
- [x] T1 — `SizeSelector`: "Comprar ahora" button -> navigates to `/checkout?variante=<id>`; same enable rules as add-to-cart availability (not the in-cart cap). Tests in `SizeSelector.test.tsx`. Commit: `fec9dc1`.
- [x] T2 — `/checkout` page: honor `?variante=`; resolve via `resolveCartLines(prisma, [{ variantId, qty: 1 }])`; redirect to `/carrito` when unresolvable/blocked; pass `buyNow` to `CheckoutForm`. Tests in checkout page tests. Commit: `a6b2e71`.
- [x] T3 — `CheckoutForm` sends `source: "buy-now"` when `buyNow`; `POST /api/checkout` skips `clearCart()` for `source === "buy-now"`. Tests in `CheckoutForm.test.tsx` and `route.test.ts`. Commit: `f8595b2`.
- [ ] T4 (pending live run) — e2e: buy now from PDP reaches checkout with only that item and leaves the cart intact. Spec written (`e2e/comprar-ahora.spec.ts`); one run attempted — blocked by a pre-existing environmental issue (see Progress), not exercised against a live server. Commit: `fd75210`.

## Route per task
- Delegated direct (writer trigger: 2+ non-trivial files across T1–T4).

## Acceptance criteria
- PDP shows "Comprar ahora"; disabled until an in-stock size is selected.
- Clicking it shows /checkout with exactly that variant, qty 1, regardless of cart contents.
- Completing a buy-now order leaves the cart cookie unchanged; a cart checkout still clears it.

## Checks
- `npm test`, `npm run lint`, `npx tsc --noEmit`, `npm run test:e2e -- e2e/carrito.spec.ts` (or new spec).

## Progress
- Exploration done; branch created.
- T1–T3 implemented via strict TDD (RED observed, then GREEN), each committed as its own work unit.
- T2 required an extra regression fix: `producto/[slug]/page.test.tsx` broke because `SizeSelector` now calls `useRouter()`; fixed by mocking `next/navigation` there too (same commit as T2).
- T2's `hasBlockingLines` redirect check was added only for the buy-now branch, per "Cart mode unchanged" — the pre-existing cart-flow redirect condition (empty/dropped only) was left untouched.
- T4 spec written (`e2e/comprar-ahora.spec.ts`), following `e2e/carrito.spec.ts`'s house style. One `npm run test:e2e -- e2e/comprar-ahora.spec.ts` run was attempted: Playwright's own `next dev` webServer (port 3100) failed to start because a *different*, pre-existing `next dev` process (PID 1504, port 3000) was already holding Next's single-instance dev-server lock for this project directory — a repo/environment state issue unrelated to the buy-now code, not touched or caused by this task. Did not kill that process (out of scope / unclear ownership). The spec itself was not exercised against a live server as a result.
- `npm test` (full suite): 67 test files, 571 tests, all passed (546s).
- `npm run lint`: 2 pre-existing errors in `AddVariantForm.tsx` (react/no-unescaped-entities), from commit `35283f3`, predating this branch — unrelated to this feature, file never touched.
- `npx tsc --noEmit`: clean.

## Next step
- Re-run `npm run test:e2e -- e2e/comprar-ahora.spec.ts` once the stray `next dev` process on port 3000 is stopped (or run e2e in an environment without a conflicting dev server), then commit the spec file.
- Native review (reliability lens): approved and acknowledged. Advisory follow-ups: run e2e live; assert cookies() not called in buy-now page test; repeated ?variante= (array) silently falls back to cart mode.
