# Proposal: Control de Caja — Unified Revenue View

## Intent

Today the store has no way to answer "how much did we sell today, and how was it paid?". In-person sales (`sellInStore()`) write only a `StockMovement(IN_STORE_SALE)` — no price, no payment method, zero revenue data. Online revenue exists (`OrderItem.unitPrice`) but is never aggregated, and `PICKUP_CASH` revenue is bundled because staff never record efectivo vs. transferencia. Owner reconciles cash by hand.

## Scope

### In Scope

- New `Sale` model + `PaymentMethod` enum (`CASH`, `TRANSFER`) in `prisma/schema.prisma`; one `Sale` row per variant sold, matching current `sellInStore()` granularity.
- `sellInStore()` writes `Sale` (unitPrice resolved as `variant.priceOverride ?? variant.product.price`) transactionally with the existing `StockMovement`.
- `CajaRowActions` "Vender 1" gains a required efectivo/transferencia choice before POST (new UI — no dialog pattern exists to reuse).
- `OrderPickupButton` prompts efectivo/transferencia when `order.method === "PICKUP_CASH"`; `markPickedUp()` persists it. **Decision locked by owner**: transferencia at the pickup moment is a real case, not just a confirmation of a prior transfer — the prompt is a genuine choice.
- New report page under `/admin/(console)` + nav link: gross revenue split efectivo / transferencia / pago online (MP), filterable by a single day OR a date range (e.g. close out a month). **Decision locked by owner** — day-only was insufficient.
- Void/anular action for a mistakenly-recorded in-person `Sale`: reverses its `StockMovement` (restocks the qty) and excludes the voided `Sale` from revenue totals. **Decision locked by owner.**

### Out of Scope

- Split payment on a single sale (part efectivo + part transferencia) — **decision locked by owner**: not allowed; each sale has exactly one payment method.
- Ganancia/profit — no cost field exists on `Product`/`Variant`.
- Backfilling historical `IN_STORE_SALE` rows (no price data ever captured).
- Cart/receipt-per-visit grouping; `Order` retrofit (explicitly rejected).
- `StockMovement` schema changes beyond what voiding requires — stays otherwise a pure inventory ledger.
- Undo/void for `PICKUP_CASH` pickups or online `Order`s — voiding is scoped to in-person `Sale` rows only.

## Capabilities

### New Capabilities
- `sales-revenue`: in-person `Sale` recording with payment method (single method per sale, voidable), and day-or-range/method revenue aggregation across `Sale` ∪ `Order(PAID|PICKED_UP)`.

### Modified Capabilities
- `admin-console`: caja sale requires payment-method choice; new revenue report page + nav entry.
- `order-lifecycle`: `PICKUP_CASH` pickup MUST capture payment method at the commit moment.

## Approach

Additive. New `Sale` table paired transactionally with existing writes; new `src/modules/reports/caja-report.service.ts` runs grouped queries and merges in memory (mirrors `getCajaRows()`). Report page follows console conventions: server component, `force-dynamic`, table styling per `ejemplo/DESIGN.md`; mutations stay thin `src/app/api/admin/**` routes + `router.refresh()`.

## Affected Areas

| Area | Impact | Description |
|------|--------|-------------|
| `prisma/schema.prisma` | New | `Sale`, `PaymentMethod`, `Order.paymentMethod?` |
| `src/modules/inventory/stock.service.ts` | Modified | `sellInStore()` takes price + method |
| `src/app/api/admin/stock/sell/route.ts` | Modified | Validate `paymentMethod` |
| `src/components/admin/CajaRowActions.tsx` | Modified | Payment-method prompt |
| `src/modules/orders/order.service.ts` | Modified | `markPickedUp()` records method |
| `src/components/admin/OrderPickupButton.tsx` | Modified | Prompt for `PICKUP_CASH` |
| `src/modules/reports/caja-report.service.ts` | New | Aggregation, day or date-range |
| `src/app/admin/(console)/reportes/page.tsx`, `layout.tsx` | New/Modified | Report + nav, date-range filter UI |
| `src/app/api/admin/sales/[saleId]/void/route.ts` (or similar) | New | Void a `Sale`, restock, exclude from revenue |

## Risks

| Risk | Likelihood | Mitigation |
|------|------------|------------|
| Extra click slows counter sales | Med | Two large buttons, no modal chrome |
| Migration on live data | Med | Nullable `Order.paymentMethod`; `Sale` additive |
| Report reads as incomplete pre-ship-date | High | State the start-date limitation in the UI |
| Voiding a `Sale` twice, or long after the fact (stock already moved again) | Med | Void is idempotent (guard on already-voided state); restock via the same conditional-UPDATE pattern `stock.service.ts` already uses, never a blind `+qty` |

## Rollback Plan

Revert app code; `Sale` and `PaymentMethod` are additive and orphan-safe. `Order.paymentMethod` is nullable — leave in place; a down-migration dropping `Sale` is safe only before first production sale. No existing read path depends on either.

## Dependencies

Prisma migration on the DonWeb VPS Postgres instance.

## Success Criteria

- [ ] Every new in-person sale persists unitPrice + a single payment method (no split payments).
- [ ] Every `PICKUP_CASH` pickup persists a payment method.
- [ ] Report shows gross revenue split efectivo / transferencia / MP, filterable by one day or a date range.
- [ ] A mistakenly-recorded `Sale` can be voided: stock is restored and it is excluded from revenue.
- [ ] `StockMovement` and `Order` semantics unchanged for existing flows.
