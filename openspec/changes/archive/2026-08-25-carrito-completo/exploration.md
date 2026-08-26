# Exploration: Completar el carrito de compras

## Current State

**Cart module** (`src/modules/cart/cart.ts`, pure, tested in `cart.test.ts`): `addItem` is wired end-to-end. `updateQty` and `removeItem` are fully implemented and unit-tested but **not imported by `cart-cookie.ts`** (its import line pulls only `addItem, parseCart, serializeCart`) and have zero callers anywhere in `src/`.

**Cookie wrapper** (`src/modules/cart/cart-cookie.ts`): `getCart`/`addToCart`/`addOneToCart`/`clearCart` operate on one httpOnly `dominique_cart` cookie (30-day maxAge), no DB `Cart` model. **Confirmed: `clearCart()` has zero callers anywhere in `src/`** — grepped `clearCart|cart-cookie` across the whole tree; the only hits are the definition, comments, and the two legitimate `getCart`/`addOneToCart` call sites. Neither `api/checkout/route.ts` nor `order.service.ts` imports from `cart-cookie.ts`.

**End-to-end journey, verified against current source:**

1. PDP → `SizeSelector.tsx`: size buttons + "Agregar al carrito" → `onAddToCart` fires the `addOneToCart` Server Action, fire-and-forget — zero loading state, zero toast, zero visual feedback. No toast library exists in `package.json` (confirmed by grep) — any toast approach is net-new infra, not an unwired existing one.
2. **Dead end**: `Header.tsx` has no cart icon, badge, or link anywhere. No `/cart` or `/carrito` route exists (`src/app/(store)/` only has root, `categoria/[slug]`, `producto/[slug]`, `checkout`, `pedido/[code]`). The original 2026-08-13 `design.md` routing table explicitly planned a `carrito` route that was simply never built — not a deliberate deferral, an oversight.
3. `/checkout` (`checkout/page.tsx`, Server Component): reads the cart cookie, resolves variants via Prisma. **If a variant no longer resolves (deleted/archived product), that line is silently dropped** (`.filter(item => item !== null)`) with zero customer notice — distinct from the stock-insufficient case caught at submission.
4. `CheckoutForm.tsx`: item list is **read-only** — no qty edit, no remove-line control anywhere — followed by contact fields, payment radio, submit.
5. **Concrete finding**: `StockUnavailableError` (`order.service.ts`) already carries `public readonly variantIds: string[]`, and the route's 409 response already forwards it (`{ error: "stock_unavailable", variantIds, message }`). But `CheckoutForm.tsx`'s catch block only reads `body.message` — `body.variantIds` is parsed by nobody. **The backend already supports precise per-line failure reporting; the frontend throws that data away.**
6. On success: PICKUP_CASH shows an inline confirmation, no redirect, cart untouched. MercadoPago redirects to `init_point`; `back_urls.success/pending/failure` **all point to the same** `/pedido/[code]` URL, a pure Server Component reading only the DB (never touches the cart cookie, for any outcome).
7. **Confirmed: no code path anywhere in the app calls `clearCart()`.** After any successful purchase, the cart cookie still holds the just-purchased items.
8. The per-identity `PICKUP_CASH` reservation cap (N=3) keys only on email+phone match — confirmed unrelated to cart contents/size, genuinely out of scope for this change.

## Affected Areas

- `src/components/storefront/Header.tsx` — no cart entry point exists.
- `src/components/storefront/CheckoutForm.tsx` — read-only item list; discards `body.variantIds` on the 409 stock-unavailable response.
- `src/modules/cart/cart.ts` / `cart-cookie.ts` — `updateQty`/`removeItem` exist and are tested but need Server Action wrappers plus a caller; `clearCart()` needs a caller.
- `src/app/api/checkout/route.ts` / `src/modules/orders/order.service.ts` — natural site to call `clearCart()` post-success (exact timing is an open question — see Risks).
- `src/components/storefront/SizeSelector.tsx` — candidate site for add-to-cart feedback.
- `src/app/(store)/checkout/page.tsx` — bare-text empty state today; silently drops deleted-product lines.
- No toast/notification library exists in `package.json` — any toast-based approach is net-new infrastructure.

## Approaches

1. **Finish the existing cookie-only cart (no DB model).** Pros: `updateQty`/`removeItem` already written and tested, zero schema migration, matches every existing architectural comment's stated rationale (guest-only, no accounts, no server session to key a DB cart by). Cons: stays per-browser only (an accepted existing constraint, not a new one). Effort: Low — this is wiring, not architecture.
2. **Move the cart to a DB-backed model.** Pros: cross-device persistence. Cons: contradicts the project's explicit guest-only/no-accounts stance; would require inventing an identity concept that doesn't exist anywhere else in the app. Effort: High, currently unjustified.

## Recommendation

Approach 1. The pure-function layer is already built and tested — this is a wiring/UX completion task, not a missing architecture. Approach 2 is a real fork; flag it explicitly if it resurfaces, don't silently drift into it.

## Risks / Open Questions for `sdd-propose`

- **Post-purchase `clearCart()` timing** has a real correctness trade-off: clearing before MercadoPago payment is confirmed could strand a shopper with an emptied cart on an abandoned/failed payment.
- **DB-backed cart vs. cookie-based cart** is a real architectural fork that should not be silently decided.
- **Dedicated `/carrito` page vs. extending `/checkout`** doubles the UI surface needing qty/remove/error-state handling if both are built; picking one changes effort sizing materially.
- **Wiring the already-returned `variantIds` payload** touches user-facing es-AR error copy and needs explicit sign-off on exact phrasing.

11 open UX/product questions were identified for `sdd-propose`'s interactive question round: cart entry point (icon/badge/link + destination), qty-edit/remove UI placement, zero-qty behavior (auto-remove vs. explicit action), empty-cart state, post-purchase clear timing, per-line stock-failure UX (now that `variantIds` is available), client-side qty cap against available stock, add-to-cart feedback style, cookie lifetime (30 days was fine for an invisible staging area — is it still right for a visible, editable cart?), silently-dropped deleted-product-line notice, and confirming MP pending/failure page scope stays untouched.

## Ready for Proposal

Yes — all codebase facts above were freshly verified against current source, not assumed. Next: `sdd-propose`.
