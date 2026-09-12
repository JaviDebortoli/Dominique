# Tasks: Control de Caja — Unified Revenue View

## Review Workload Forecast

| Field | Value |
|-------|-------|
| Estimated changed lines | ~1,700–1,950 (additions+deletions) |
| 400-line budget risk | High |
| Chained PRs recommended | Yes |
| Suggested split | PR1 Schema → PR2 Sell → PR3 Void → PR4 Pickup → PR5 Report → PR6 E2E |
| Delivery strategy | single-pr (locked) |
| Chain strategy | pending |

Decision needed before apply: Yes
Chained PRs recommended: Yes
Chain strategy: pending
400-line budget risk: High

**Note**: this session's locked review budget is 800 lines (not the skill default 400). The estimate above (~1,700–1,950) exceeds even that locked 800-line budget by roughly 2x — 17 files touched, 1 migration, ~11 new/extended test files, 4 UI components, 1 new report service+page. Orchestrator must either require an explicit `size:exception` (per `single-pr` + High risk) or override delivery to a chained strategy before `sdd-apply`.

### Suggested Work Units

| Unit | Goal | Likely PR | Focused test command | Runtime harness | Rollback boundary |
|------|------|-----------|----------------------|-----------------|-------------------|
| 1 | Schema: `PaymentMethod`, `Sale`, `Order.paymentMethod` | PR1 | `npx prisma validate` | N/A — schema/migration only, no app read path touches it yet | Drop `sales` table + column via down-migration; orphan-safe |
| 2 | In-person sale recording (service + route + UI) | PR2 | `npm test -- src/modules/sales/sale.service.test.ts src/app/api/admin/stock/sell/route.test.ts` | Manual: sell 1 unit at `/admin/caja` with a method chosen | Revert `sale.service.ts`, sell route, `CajaRowActions.tsx`, `PaymentMethodChoice.tsx` |
| 3 | Sale voiding (service + route + UI) | PR3 | `npm test -- src/modules/sales/sale.service.test.ts src/app/api/admin/sales` | Manual: void a same-day sale at `/admin/caja`, confirm stock restored | Revert `voidSale()`, void route, `VoidSaleButton.tsx`; PR2 unaffected |
| 4 | `PICKUP_CASH` payment-method capture | PR4 | `npm test -- src/modules/orders/order.service.test.ts src/app/api/admin/orders` | Manual: mark a `PICKUP_CASH` order picked up at `/admin/pedidos` | Revert `markPickedUp()` options param, pickup route, `OrderPickupButton.tsx` prop |
| 5 | Revenue report (day-edge lib + aggregation service + page + nav) | PR5 | `npm test -- src/lib/report-day.test.ts src/modules/reports/caja-report.service.test.ts` | Manual: open `/admin/reportes`, single day and range filters | Remove `reportes/page.tsx`, nav link, report service; PR2–4 unaffected |
| 6 | E2E coverage | PR6 | `npx playwright test e2e/admin-caja-reportes.spec.ts` | Real: sell → report → void → report/stock, full browser run | Remove the one new e2e spec file |

## Phase 1: Foundation — Schema & Migration

- [x] 1.1 Add `PaymentMethod` enum, `Sale` model, `Order.paymentMethod?`, and `Variant`/`AdminUser` back-relations to `prisma/schema.prisma` per design.md D1/D3 exact shapes.
- [x] 1.2 Generate the additive Prisma migration (`sales` table + 2 indexes, nullable `orders.paymentMethod` column); apply to test DB (`npm run db:test:setup`).
- [x] 1.3 Run `npx prisma generate`; verify `tsc`/typecheck passes with the new `Sale`/`PaymentMethod` types.

## Phase 2: In-Person Sale Recording

- [x] 2.1 RED: `src/modules/sales/sale.service.test.ts` — `recordInStoreSale()` creates one `Sale` (`unitPrice = priceOverride ?? price`) + `StockMovement(IN_STORE_SALE)` in one tx.
- [x] 2.2 RED: same file — `OutOfStockError` rolls back both rows (zero `Sale` rows after failure).
- [x] 2.3 GREEN: implement `src/modules/sales/sale.service.ts` `recordInStoreSale()` composing existing `sellInStore()` + `Sale.create()` in one `$transaction`.
- [x] 2.4 RED: `src/app/api/admin/stock/sell/route.test.ts` — reject missing/invalid `paymentMethod` (400 `invalid_request`) and >1 method.
- [x] 2.5 GREEN: update `src/app/api/admin/stock/sell/route.ts` to validate `paymentMethod ∈ {CASH,TRANSFER}` and call `recordInStoreSale()`.
- [x] 2.6 GREEN: create `src/components/admin/PaymentMethodChoice.tsx` (props: `label`, `pending`, `onChoose`, `onCancel`; `role="group" aria-label="Método de pago"`, focus-first, Escape collapses) per D6.
- [x] 2.7 RED: `src/components/admin/CajaRowActions.test.tsx` — "Vender 1" reveals Efectivo/Transferencia/Cancelar; blocks POST until a method is chosen; POST body includes `paymentMethod`.
- [x] 2.8 GREEN: update `CajaRowActions.tsx` to use `PaymentMethodChoice` and carry `paymentMethod` in the sell POST.

## Phase 3: Sale Voiding (Anular)

- [x] 3.1 RED: extend `sale.service.test.ts` — `voidSale()` restocks exactly `+qty` once, sale excluded from future report queries.
- [x] 3.2 RED: same — second `voidSale()` call throws `SaleAlreadyVoidedError`, no second restock.
- [x] 3.3 RED: same — void of a sale with `soldAt` = yesterday throws `SaleVoidWindowClosedError`, no restock (same-caja-day window, owner-confirmed).
- [x] 3.4 RED: same — concurrent double-void via `Promise.allSettled`: exactly one 200, one 409, restock applied once.
- [x] 3.5 GREEN: implement `voidSale()` — atomic claim UPDATE (`voidedAt IS NULL AND soldAt >= startOfArgentinaDay`), 0-row reclassify to 404/409, conditional-update restock mirroring `adjust()`.
- [x] 3.6 RED: `src/app/api/admin/sales/[saleId]/void/route.test.ts` — 401, 404 `sale_not_found`, 409 `already_voided`, 409 `void_window_closed`, 200.
- [x] 3.7 GREEN: create `src/app/api/admin/sales/[saleId]/void/route.ts` — `auth()` + `voidSale()` + error-to-status mapping.
- [x] 3.8 RED: `src/components/admin/VoidSaleButton.test.tsx` — renders "Anular" only when not voided, posts to void route, hides after 200.
- [x] 3.9 GREEN: create `src/components/admin/VoidSaleButton.tsx` — inline confirm + POST + `router.refresh()`.

## Phase 4: `PICKUP_CASH` Payment-Method Capture

- [x] 4.1 RED: extend `src/modules/orders/order.service.test.ts` — `markPickedUp()` throws `PaymentMethodRequiredError` for `PICKUP_CASH` with no method given/set; persists method on success; MP/`PAID` branch unchanged.
- [x] 4.2 GREEN: update `markPickedUp(prisma, orderId, options?)` in `src/modules/orders/order.service.ts` per D3/diagram (c).
- [x] 4.3 RED: `src/app/api/admin/orders/[orderId]/pickup/route.test.ts` — tolerates empty body for MP orders, 400 `payment_method_required` for `PICKUP_CASH` without method, 200 persists method.
- [x] 4.4 GREEN: update `src/app/api/admin/orders/[orderId]/pickup/route.ts` to parse optional `paymentMethod` and surface the new error as 400.
- [x] 4.5 RED: `src/components/admin/OrderPickupButton.test.tsx` — prompts payment method only when `requiresPaymentMethod`; MP path posts immediately, no prompt.
- [x] 4.6 GREEN: add `requiresPaymentMethod` prop to `OrderPickupButton.tsx` (reuses `PaymentMethodChoice`); wire `pedidos/page.tsx` to pass `order.method === "PICKUP_CASH"`.

## Phase 5: Revenue Report

- [x] 5.1 RED: `src/lib/report-day.test.ts` — UTC−3 day-edge resolution incl. 21:30-ART-is-next-UTC-day case.
- [x] 5.2 GREEN: create `src/lib/report-day.ts` resolving `YYYY-MM-DD` → `Date.UTC(y,m,d,3,0,0)` per D5.
- [x] 5.3 RED: `src/modules/reports/caja-report.service.test.ts` — bucketing/merge incl. `UNKNOWN` legacy bucket from faked Q1/Q2/Q3 results.
- [x] 5.4 RED: same — 3-line PAID order counted once (`distinct:["orderId"]` load-bearing), voided sale excluded, single-day + date-range scenarios, pre-ship-date honest-empty-state scenario.
- [x] 5.5 GREEN: create `src/modules/reports/caja-report.service.ts` `getRevenueReport()` — Q1/Q2/Q3 + in-memory `Prisma.Decimal` merge per diagram (d).
- [x] 5.6 GREEN: create `src/app/admin/(console)/reportes/page.tsx` — force-dynamic, day/range form, totals table, today's sales list with `VoidSaleButton`.
- [x] 5.7 GREEN: update `src/app/admin/(console)/layout.tsx` — nav `<Link href="/admin/reportes">Reportes</Link>`.

## Phase 6: End-to-End Coverage

- [x] 6.1 Add `e2e/admin-caja-reportes.spec.ts` (Playwright, matching `e2e/admin-console.spec.ts` convention): sell with method → report shows it → void → report drops it and stock returns. Spec created and syntax-validated (`npx playwright test --list`); full browser execution blocked this session by a live dev server + ngrok tunnel already bound to port 3000 (Next.js's dev-server singleton lock refuses a second `next dev` instance in the same project dir even on a different port) — see apply-progress/risks for details. The exact same flow is proven via real-Postgres integration tests instead.
