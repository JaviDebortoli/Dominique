# Exploration: control-de-caja (unified revenue view — in-person + online, by day/payment method)

## Current State

**In-person sales (the gap).** `/admin/caja` (`src/app/admin/(console)/caja/page.tsx`) is a read-model of `Variant.onHand/held` via `getCajaRows()` (`src/modules/inventory/caja.service.ts`, read-only, no financial data). Each row's "Vender 1" button (`CajaRowActions.tsx`) fires a single fire-and-forget POST to `/api/admin/stock/sell` (`src/app/api/admin/stock/sell/route.ts`), which calls `sellInStore()` in `src/modules/inventory/stock.service.ts` (~line 221). Confirmed: `SellInStoreParams = { variantId, qty, actorId }` — no price, no payment method, no total. It does one conditional `UPDATE variants SET "onHand" = "onHand" - qty WHERE "onHand" - held >= qty` and writes one `StockMovement { delta: -qty, reason: IN_STORE_SALE, actorId }`. Zero revenue data. The UI is a single button, no dialog/confirmation step of any kind today — adding a required payment-method choice is new UI, not a tweak of an existing one.

**Online/pickup sales (data already exists).** `OrderItem.unitPrice` (Decimal) is captured at order-creation time in `order.service.ts::createPendingOrder()` as `variant.priceOverride ?? variant.product.price` — this is the exact source-of-truth pattern a new `Sale.unitPrice` should mirror. Revenue for `MP` orders is computable once `status` reaches `PAID` (set in `confirmPaymentApproved()`, which also runs `commitPaid()` inside the same transaction as the `Payment` row insert).

**Correction to the business-problem's framing — no separate "mark as paid" action exists for `PICKUP_CASH` orders.** Verified `order.service.ts::markPickedUp()` line-by-line: it has two branches by source status —
- `PAID` (MP path): stock was already committed at webhook time; this is a pure status flip to `PICKED_UP`, no money changes hands here.
- `RESERVED` (the `PICKUP_CASH` path): there is **no intermediate `PAID` state** for this method. `markPickedUp()` runs `commitPaid()` for every line **and** flips status straight to `PICKED_UP` in one transaction. This is the exact moment cash/transfer money is collected in person.

Both branches are wired to the SAME staff action: the "Marcar retirado" button (`OrderPickupButton.tsx` → `POST /api/admin/orders/[orderId]/pickup` → `markPickedUp()`). There is currently no UI moment, anywhere, where staff choose efectivo vs. transferencia for a `PICKUP_CASH` order. This needs an explicit proposal-phase decision — it is the only way `PICKUP_CASH` revenue could ever be split cash-vs-transfer; without it, all `PICKUP_CASH` pickups stay bundled forever, undermining the report's "by payment method" requirement for that whole order method.

**Schema facts confirmed directly from `prisma/schema.prisma`:**
- `enum OrderMethod { MP, PICKUP_CASH }` (line 97) — no separate CASH/TRANSFER anywhere.
- `enum OrderStatus { PENDING_PAYMENT, RESERVED, PAID, PICKED_UP, EXPIRED, CANCELLED }` (line 105) — comment literally states "RESERVED -> PAID/PICKED_UP" but the only code path found (`markPickedUp`) goes RESERVED straight to PICKED_UP; no code sets a RESERVED order to PAID directly.
- `Order` (line 114): no payment-method-detail field beyond `method`.
- `OrderItem.unitPrice Decimal @db.Decimal(10,2)` (line 137) — usable for revenue.
- `Payment` model (line 153): one row per Order (`orderId @unique`), only written on the MP `approved` path; carries `amount` but this is MP-specific, not a general payment-method disambiguator.
- `StockMovement` (line 177): `{ id, variantId, delta, reason, orderId?, actorId?, at }` — confirmed no price field, purely an inventory ledger; `enum StockMovementReason { HOLD, RELEASE, PAID, IN_STORE_SALE, ADJUSTMENT, EXPIRE }`.
- `Product` (line 31): `price Decimal` only — **no cost field anywhere in the schema** (confirmed via grep across `Product`/`Variant`). "Ganancia"/profit is definitively out of scope; only gross revenue is achievable with existing data.

**Admin console conventions** (from `layout.tsx`, `caja/page.tsx`, `pedidos/page.tsx`):
- Route group `src/app/admin/(console)/` with a shared layout that renders a flat nav (`Caja | Productos | Categorías | Pedidos`) — a new report page needs its own `<Link>` added to that same nav bar.
- Every list page is a server component, `export const dynamic = "force-dynamic"` (explicit "staff must see truth, not stale data" rule, no caching layer), reading Prisma directly, rendered as a `<table>` with a consistent set of Tailwind classes.
- Mutating actions are thin API routes under `src/app/api/admin/**` (session-checked via `auth()` inline, not covered by `middleware.ts`'s matcher) called from small `"use client"` button components that `router.refresh()` on success — this is the pattern a new "record a payment method for this sale" action would follow, not Next.js server actions (those are only used for `signOutAction` in `actions.ts`).

## Affected Areas

- `prisma/schema.prisma` — add new `Sale` model + a `PaymentMethod` enum (`CASH`, `TRANSFER`) purpose-built for in-person sales, per the owner's already-made decision not to retrofit `Order`.
- `src/modules/inventory/stock.service.ts` — `sellInStore()` currently has no price/paymentMethod capture; needs either an additive parameter set (unitPrice, paymentMethod) writing a `Sale` row in the same transaction as the existing `StockMovement(IN_STORE_SALE)` write, or a new sibling module (e.g. `src/modules/sales/sale.service.ts`) that composes `sellInStore()` + `Sale` creation transactionally without touching the existing stock-only contract.
- `src/app/api/admin/stock/sell/route.ts` — request body validation needs `paymentMethod` (and price resolution, mirroring `variant.priceOverride ?? variant.product.price` from `order.service.ts`).
- `src/components/admin/CajaRowActions.tsx` — "Vender 1" is currently a single-click button with zero confirmation UI; needs a payment-method choice surfaced before the POST fires (no existing modal/dialog pattern in this codebase to reuse — this is new UI).
- `src/modules/orders/order.service.ts` (`markPickedUp()`) and `src/components/admin/OrderPickupButton.tsx` — the real "money changes hands" moment for `PICKUP_CASH` orders; in scope only if the proposal decides pickup-time cash/transfer disambiguation is required for report completeness (see correction above).
- `src/app/admin/(console)/layout.tsx` — nav bar needs a new `<Link>` for the report page.
- `src/app/admin/(console)/caja/page.tsx` and `pedidos/page.tsx` — structural/style templates to follow for the new report page (server component, `force-dynamic`, table conventions).
- New: a report aggregation module (e.g. `src/modules/reports/caja-report.service.ts`) querying `Sale` (grouped by day/paymentMethod) UNION `Order` where `status IN (PAID, PICKED_UP)` (grouped by day, split `MP` vs the `PICKUP_CASH` cash/transfer question above) — pattern to mirror is `caja.service.ts::getCajaRows()`'s multi-query-then-merge-in-memory approach.
- New: a report page, e.g. `src/app/admin/(console)/caja/reporte/page.tsx` or `.../reportes/page.tsx`.

## Approaches

1. **New `Sale` model, one row per in-person sale line (mirrors `sellInStore()`'s existing one-variant-at-a-time granularity).** Additive, transactionally paired with the existing `StockMovement(IN_STORE_SALE)` write; new report service aggregates `Sale ∪ Order(PAID/PICKED_UP)` by day/method.
   - Pros: matches the owner's explicit decision; zero changes to `Order`'s shape or semantics; `StockMovement` stays a pure inventory ledger; low blast radius; `Sale` granularity matches today's UX exactly (no new "cart" concept to design).
   - Cons: still requires new UI on `CajaRowActions` to capture payment method before submit; a walk-in customer buying 3 different variants in one visit produces 3 `Sale` rows rather than 1 "transaction" (fine for a total-by-day/method report; would matter only for a future per-visit receipt feature).
   - Effort: Medium.
2. **Denormalize price + paymentMethod directly onto `StockMovement`** — skip a new model, add nullable columns to the existing ledger.
   - Pros: no new table; one fewer join for reporting.
   - Cons: pollutes an inventory ledger (used by `HOLD`/`RELEASE`/`ADJUSTMENT`/`EXPIRE` too) with financial columns meaningless for 5 of its 6 reasons; contradicts the owner's explicit ask for "a new, separate model"; every future non-sale `StockMovement` reason inherits dead financial columns.
   - Effort: Low upfront, but accrues schema debt.
3. **Retrofit `Order` to also represent walk-in sales** (named only for completeness — already rejected in the live conversation with the owner).
   - Pros: reuses existing `OrderItem.unitPrice` + revenue math already built for online orders.
   - Cons: forces buyer/reservation/expiry fields that don't apply to a walk-in sale (no buyer contact collected in person); explicitly rejected by the owner.
   - Effort: N/A — rejected, listed only to show it was considered.

## Recommendation

Approach 1 (new `Sale` model, one row per current `sellInStore()` granularity) — it is what the owner already decided, it is additive (does not disturb `Order`, `StockMovement`, or existing tested behavior), and it reuses the exact `priceOverride ?? product.price` pattern already proven in `order.service.ts`. Bring the `markPickedUp()`/`OrderPickupButton` cash-vs-transfer gap explicitly into the proposal phase as a scoped decision (in scope now, or deferred with an accepted "PICKUP_CASH stays bundled" limitation) rather than letting it default silently — it directly determines whether the "by payment method" report requirement can ever be met for that order method.

## Risks / Open Questions for `sdd-propose`

- **Framing correction (load-bearing):** there is no existing "mark as paid" action for `PICKUP_CASH` orders distinct from "mark picked up" — `markPickedUp()` IS the payment-commit moment for that path (RESERVED → PICKED_UP directly, no PAID intermediate state occurs on that branch in any code path found). The proposal must decide, explicitly, whether `OrderPickupButton` gains a cash/transfer prompt for that method, or the report accepts `PICKUP_CASH` revenue only as a bundled total forever.
- Historical `IN_STORE_SALE` `StockMovement` rows have no price column at all (confirmed by direct schema read) — cannot be retroactively backfilled into revenue; report necessarily starts from ship date forward. Accepted gap, not a bug.
- No cost field exists anywhere on `Product`/`Variant` (confirmed via grep) — "ganancia"/profit is out of scope; only gross revenue is achievable. Flag as a scope boundary to confirm explicitly in the proposal.
- `CajaRowActions`'s "Vender 1" flow has no existing confirmation/dialog UI pattern anywhere in this codebase to reuse for a required payment-method choice — this is genuinely new UI, and should be estimated as such.
- `Sale` granularity decision (one line per row vs. a cart-like `Sale`+`SaleItem` header/detail) should default to matching current `sellInStore()`'s one-variant-at-a-time flow for effort reasons; revisit only if a future "one receipt per visit" requirement surfaces.

## Ready for Proposal

Yes — with one explicit decision the proposal phase must resolve up front (not silently default): whether pickup-time cash/transfer disambiguation for `PICKUP_CASH` orders (via `OrderPickupButton`/`markPickedUp()`) is in scope for this change, since it is the only way that order method's revenue can ever be split by payment method in the new report.
