# Tasks: Completar el carrito de compras

## Review Workload Forecast

| Field | Value |
|-------|-------|
| Estimated changed lines | ~950–1300 total (3 slices); PR1 ~550–650, PR2 ~200–260, PR3 ~220–280 |
| 400-line budget risk | High |
| 800-line budget risk (this session's budget) | High combined as one PR / Medium per chained slice |
| Chained PRs recommended | Yes |
| Suggested split | PR1 cart core → PR2 storefront entry point → PR3 checkout integration |
| Delivery strategy | ask-on-risk → resolved: chained (owner chose to split over `size:exception`) |
| Chain strategy | **stacked-to-main** — owner-confirmed; matches this repo's existing `feat/admin-productos-edicion-{routes,service,ui,variantrow}` precedent |

Decision needed before apply: Resolved
Chained PRs recommended: Yes
Chain strategy: stacked-to-main
400-line budget risk: High
800-line budget risk: High

### Suggested Work Units

| Unit | Goal | Likely PR | Focused test command | Runtime harness | Rollback boundary |
|---|---|---|---|---|---|
| 1 | Cart core: resolver + actions + `/carrito` page | PR1 | `pnpm vitest run src/modules/cart src/app/(store)/carrito src/components/storefront/CartLineControls.test.tsx` | `pnpm dev` → add item → open `/carrito`, edit qty, Eliminar | Delete `carrito/`, `cart-lines.*`, `CartLineControls.*`; revert `cart-cookie.ts` additions |
| 2 | Storefront entry point: header badge + PDP cap | PR2 | `pnpm vitest run src/components/storefront/Header.test.tsx src/components/storefront/SizeSelector.test.tsx` | `pnpm dev` → add item → see badge; open PDP at stock cap | Revert `Header.tsx`, `layout.tsx`, `SizeSelector.tsx`, `producto/[slug]/page.tsx` diffs |
| 3 | Checkout integration: `clearCart()` + 409 copy + slimming | PR3 | `pnpm vitest run src/app/api/checkout src/components/storefront/CheckoutForm.test.tsx` | `pnpm dev` → full checkout both methods, confirm cart empties | Revert `checkout/page.tsx`, `CheckoutForm.tsx`; remove the `clearCart()` line in `route.ts` |

## Phase 1: Cart Core (PR1)

- [x] 1.1 TDD `cart-lines.ts` + `cart-lines.test.ts`: RED stub `db.variant.findMany` (dropped, exceedsStock, isUnavailable, subtotal, itemCount, priceOverride precedence) → GREEN implement `resolveCartLines(db, cart)` per design interfaces.
- [x] 1.2 GREEN `cart-cookie.ts`: add `updateCartQty`/`removeCartItem` actions (qty<=0→removeItem), `refresh()` in all mutating actions except `clearCart`, `maxAge` 30d→7d. No dedicated unit test (request-scoped `cookies()`); covered by 1.3/3.1.
- [x] 1.3 TDD `carrito/page.tsx` + `page.test.tsx`: RED async-render cases (empty state, dropped-line notice, over-stock flag, mirrors `producto/[slug]/page.test.tsx`) → GREEN build Server Component using `resolveCartLines`.
- [x] 1.4 TDD `CartLineControls.tsx` + test: RED RTL/user-event (`−` disabled at 1, `+` disabled at max, bound actions fire with right args) → GREEN client island; wire bound actions in `carrito/page.tsx`.

## Phase 2: Storefront Entry Point (PR2)

- [x] 2.1 TDD `Header.tsx` + test: RED badge hidden at 0/shown at n/links `/carrito`/aria-label → GREEN icon + badge per design Visual Design.
- [x] 2.2 GREEN `(store)/layout.tsx`: read `getCart()`, compute `cartCount`, pass to `Header` (design D2). Plain prop wiring, exercised by 2.1's render.
- [x] 2.3 TDD `SizeSelector.tsx` + `producto/[slug]/page.tsx` + test: RED at-cap disable via `inCartQty` prop, copy "Ya tenés el máximo disponible" (DA-1) → GREEN implement cap + wire `inCartQty` from PDP.

## Phase 3: Checkout Integration (PR3)

- [x] 3.1 TDD `route.ts` + `route.test.ts`: RED cart cleared on 201 and 303, order still succeeds if cookie write throws → GREEN add `clearCart()` after `createPendingOrder`, before MP branch, try/catch-and-ignore (design D4).
- [x] 3.2 TDD `CheckoutForm.tsx` + test: RED 409 `variantIds`→line labels, unknown ids fall back to `body.message` → GREEN read-only summary + mapping.
- [x] 3.3 TDD `checkout/page.tsx` + `page.test.tsx`: RED empty-cart and dropped-line redirect cases → GREEN use `resolveCartLines`; redirect to `/carrito` when empty or `dropped.length > 0`.

## Phase 4: Threat Matrix, E2E, Non-Regression (after PR3)

- [x] 4.1 RED (extend 1.1/3.1): untrusted qty (`NaN`, `-1`, `1e9`, unknown `variantId`) degrades without throwing/corrupt cookie; cookie hand-set past stock still 409s with `variantIds`, no hold created (Threat Matrix: Untrusted input, Client-side stock cap bypass).
- [x] 4.2 `e2e/carrito.spec.ts`: PDP add → badge increments → `/carrito` edit qty/Eliminar → `/checkout` → order → cart empty (Playwright, self-cleaning suffix fixtures, house style).
- [x] 4.3 Regression: existing MP `back_urls` and N=3 reservation-cap suites in `route.test.ts` pass unmodified; `/carrito` renders without a session (outside `proxy.ts` matcher).
