# Proposal: Completar el carrito de compras

## Intent

The cart is a one-way, invisible, uneditable staging cookie. `Header.tsx` has no cart affordance and no `/carrito` route exists, so the only way to reach checkout is to type `/checkout` by hand. "Agregar al carrito" fires and forgets with zero visual feedback. `/checkout` renders the item list read-only — a shopper who picked the wrong size or clicked twice cannot fix it, only abandon. `clearCart()` has zero callers, so the cart still holds the just-purchased items after any successful order. `updateQty` and `removeItem` are already written and unit-tested in `cart.ts` but imported by nobody. `carrito` was on the original 2026-08-13 routing table and was never built — an oversight, not a deferral.

## Scope

### In Scope

- New `/carrito` page: full line list, per-line quantity control, explicit per-line removal, subtotal, empty state
- Cart entry point in `Header.tsx`: cart icon + item-count badge linking to `/carrito`
- Server Action wrappers in `cart-cookie.ts` for the existing `updateQty` / `removeItem` pure functions
- `clearCart()` wired into the successful order-creation path, both payment methods
- `/checkout` becomes payment-only: contact fields, payment method, submit, plus a read-only summary
- Client-side quantity cap at current available stock (`onHand - held`)
- Consume the already-returned 409 `variantIds` so stock-conflict copy names the failing line(s)
- `cart-checkout` and `storefront-browsing` spec deltas

### Out of Scope (Non-Goals)

- **MercadoPago `back_urls`** — success/pending/failure all resolving to `/pedido/[code]` stays exactly as is. Not touched, not silently included.
- **Per-identity `PICKUP_CASH` reservation cap (N=3)** — keys on email+phone only, has no dependency on cart contents. Untouched.
- DB-backed `Cart`/`CartItem` model — contradicts the guest-only, no-accounts stance; would require inventing an identity concept the app does not have
- Any toast/notification library — none is installed and none is added
- Cross-device or cross-browser cart persistence
- A "pay again" / "volver al carrito" affordance on `/pedido/[code]`
- Any Prisma migration

## Capabilities

### New Capabilities

- None. Cart behavior already lives under `cart-checkout`; splitting it out would fragment one flow across two specs.

### Modified Capabilities

- `cart-checkout`: gains a dedicated cart view with quantity editing and line removal, post-order cart clearing, empty-cart behavior, deleted-line notification, per-line stock-conflict reporting, and the cart cookie lifetime. None of these are speced today — they were never written, not violated. `Stock Re-Validation at Submission` stays unchanged and authoritative.
- `storefront-browsing`: gains a persistent cart entry point with item-count badge in the header, which doubles as add-to-cart confirmation.

## Approach

Exploration Approach 1 — finish the existing cookie-only cart. The pure layer (`addItem`, `updateQty`, `removeItem`, `parseCart`) is built and tested; this is wiring and UX completion, not architecture. `/carrito` is a Server Component resolving cookie lines against Prisma (same read `checkout/page.tsx` does today), with a small client island per line for the quantity control and removal. Quantity mutations go through new Server Actions that delegate to the existing pure functions and re-write the one `dominique_cart` cookie. `clearCart()` is called server-side at order creation so it works identically for the JSON 201 (PICKUP_CASH) and the 303 redirect (MP), where no client code runs after the response.

## Decided by the owner (do not re-litigate)

| Decision | Rationale |
|---|---|
| Cart lives on a dedicated `/carrito`; `/checkout` becomes the payment-only final step | Separates "fix my order" from "pay for it"; avoids one page owning both editing and payment state |
| Cart clears at **order creation**, not at payment confirmation, for both methods | Only point where server-side code runs for both the 201 and the 303 paths |
| Add-to-cart feedback = count badge on a new header cart icon | No toast library exists; a badge is the confirmation and the entry point at once |
| Client-side quantity cap at current available stock (`onHand - held`) | UI honesty only |

**Accepted tradeoff, stated plainly**: because the cart clears at order creation, a MercadoPago payment that is later abandoned or fails leaves the shopper with an already-empty cart. To retry, they must re-add their items. The owner reviewed and accepted this.

**Explicit constraint**: the server-side re-validation at `POST /api/checkout` (`StockUnavailableError`) remains the authoritative stock gate. The client cap is a courtesy layer and must not weaken, replace, or short-circuit it.

## Proposed defaults — overridable on review

| Open item | Proposed default | One-line rationale |
|---|---|---|
| Zero-qty behavior | Quantity control bottoms out at 1; removal requires an explicit **"Eliminar"** action per line | A named action cannot be triggered by an accidental repeat click on a stepper; `updateQty`'s existing `qty <= 0 → removeItem` stays as a defensive server-side path |
| Empty cart | `/carrito` shows "Tu carrito está vacío" plus one link to keep shopping; `/checkout` reached with an empty cart redirects to `/carrito` | One empty state to write and maintain; a payment-only page has nothing to render without lines |
| Deleted-product lines | `/carrito` shows an explicit notice naming what was dropped and why, instead of silently filtering; if the drop is detected at `/checkout`, redirect to `/carrito` with that notice rather than quietly changing the total at the payment step | A silently smaller total is a support contact; naming it costs one line of copy |
| 409 `variantIds` | Wire it — map the returned ids to their line labels so the error names the affected item(s) and points back to `/carrito` | The backend already returns this and the frontend discards it |
| Cookie lifetime | Shorten 30 days → **7 days** | 30 days was sized for an invisible staging area; a visible cart holding month-old prices and stock on single-digit inventory sets a false expectation |

## Edge Cases

- Cart cookie is malformed or tampered → `parseCart` already degrades to `[]`; `/carrito` renders the empty state, never an error
- A line's available stock dropped below its cart quantity while the cart sat idle → `/carrito` clamps the displayed/editable maximum and flags the line; submission is still gated server-side
- Available stock reaches 0 for a line already in the cart → line is shown as unavailable and blocks submission with named copy, not silently dropped
- Two tabs edit the cart concurrently → last write to the single cookie wins; accepted, no locking
- Order creation succeeds but the `clearCart()` write fails → order stands; a stale cart is recoverable by the shopper, a lost order is not
- Empty cart submitted directly to `POST /api/checkout` → rejected before any DB work, unchanged
- Badge count while JavaScript is disabled or before hydration → rendered from the server-read cookie, not client state

## Affected Areas

| Area | Impact | Description |
|------|--------|-------------|
| `src/app/(store)/carrito/page.tsx` | New | Editable cart view, subtotal, empty state, notices |
| `src/components/storefront/Header.tsx` | Modified | Cart icon + item-count badge linking to `/carrito` |
| `src/modules/cart/cart-cookie.ts` | Modified | Server Actions wrapping `updateQty` / `removeItem`; shorter `maxAge` |
| `src/modules/cart/cart.ts` | Unchanged | `updateQty` / `removeItem` already implemented and tested |
| `src/app/(store)/checkout/page.tsx` | Modified | Payment-only; redirect to `/carrito` when empty or when a line was dropped |
| `src/components/storefront/CheckoutForm.tsx` | Modified | Read-only summary; consume `body.variantIds` on 409 |
| `src/app/api/checkout/route.ts` | Modified | Clear the cart after successful order creation, both methods |
| `src/components/storefront/SizeSelector.tsx` | Modified | Quantity cap against available stock |
| `prisma/schema.prisma` | Unchanged | No migration |
| `src/lib/mercadopago.ts` | Unchanged | `back_urls` untouched |
| `src/modules/orders/order.service.ts` | Unchanged | Stock gate and reservation cap untouched |

## Risks

| Risk | Likelihood | Mitigation |
|------|------------|------------|
| Abandoned MP payment leaves an empty cart | Med | Accepted owner decision; documented above, not hidden |
| Client stock cap is read at render and goes stale | High | Expected — it is a courtesy layer; the server re-validation at submission remains the real gate |
| `/carrito` and `/checkout` drift into two divergent line-rendering implementations | Med | One shared line-resolution helper; `/checkout` renders a read-only summary from the same data |
| Shortening the cookie to 7 days drops carts a shopper expected to keep | Low | Single constant, trivially reverted; overridable before spec |
| Header badge count desyncs after a Server Action mutation | Med | Revalidate the cart-reading path after every mutating action so the badge is server-derived, never client-guessed |
| Scope drift toward a DB-backed cart | Low | Explicitly a non-goal; flag and stop if it resurfaces |

## Rollback Plan

Separable reverts. The `/carrito` route is additive — deleting the directory and the header badge restores today's navigation exactly. The `clearCart()` call is one line in the checkout route; removing it restores the current (broken) persist-after-purchase behavior. The cookie `maxAge` is one constant. The `variantIds` wiring and quantity cap are additive display logic inside existing components. No migration, no schema change, no order shape change, no persisted state beyond the same single `dominique_cart` cookie.

## Dependencies

- None. No new package; everything ships with what is already in `package.json`.

## Success Criteria

- [ ] Every storefront page shows a cart entry point whose badge reflects the current item count
- [ ] Adding an item from the PDP visibly changes that badge
- [ ] `/carrito` lists every cart line and allows changing quantity and removing a line
- [ ] Quantity cannot be raised past the variant's current available stock in the UI
- [ ] A cart line whose product no longer resolves produces a visible notice, never a silent disappearance
- [ ] An empty cart produces one empty state with a way forward, on `/carrito`
- [ ] After a successful order via either payment method, the cart is empty
- [ ] A 409 stock conflict at submission names the affected line(s) instead of showing only generic copy
- [ ] `POST /api/checkout` stock re-validation, MercadoPago `back_urls`, and the N=3 reservation cap behave exactly as before

## Delivery Note for `sdd-tasks`

Three separable concerns: (1) cart Server Actions + `/carrito` page + empty/notice states, (2) header entry point + badge + PDP quantity cap, (3) checkout slimming + `clearCart()` wiring + `variantIds` error copy. A new route plus a header change plus checkout restructuring puts the 400-line budget forecast at **High**; recommend chained PRs sliced along those three boundaries. `sdd-design` is warranted before apply — the new route, the header affordance, and the `/carrito` ↔ `/checkout` split are design decisions, not mechanical wiring.
