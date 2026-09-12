# Design: Control de Caja — Unified Revenue View

## Technical Approach

Additive. A new `Sale` table records in-person revenue, written in the same transaction as the existing `StockMovement(IN_STORE_SALE)`. `Order` gains one nullable `paymentMethod` column, set at the money-commit moment inside `markPickedUp()`. A new read-only `caja-report.service.ts` merges both sources in memory (the `getCajaRows()` pattern). All mutations stay thin `src/app/api/admin/**` routes called from `"use client"` components that `router.refresh()`. `StockMovement` keeps its exact current shape and semantics.

## Architecture Decisions

### D1 — `Sale` shape: flat, one row per variant sold

| Option | Tradeoff | Decision |
|---|---|---|
| Flat `Sale` (one row per variant) | Matches `sellInStore()` granularity exactly; no cart concept | **Chosen** |
| `Sale` + `SaleItem` header/detail | Enables per-visit receipts; needs new cart UI nobody asked for | Rejected |
| Financial columns on `StockMovement` | Pollutes a 6-reason inventory ledger with columns dead for 5 of them | Rejected (locked) |

```prisma
enum PaymentMethod { CASH TRANSFER }

model Sale {
  id            String        @id @default(cuid())
  variantId     String
  variant       Variant       @relation(fields: [variantId], references: [id])
  qty           Int
  unitPrice     Decimal       @db.Decimal(10, 2)   // snapshot, mirrors OrderItem.unitPrice
  paymentMethod PaymentMethod                       // exactly one, never null: no split payments
  actorId       String?
  actor         AdminUser?    @relation("SaleActor", fields: [actorId], references: [id])
  soldAt        DateTime      @default(now())
  voidedAt      DateTime?                           // null = counts as revenue
  voidedById    String?
  voidedBy      AdminUser?    @relation("SaleVoidedBy", fields: [voidedById], references: [id])

  @@index([soldAt])
  @@index([variantId])
  @@map("sales")
}
```

`unitPrice` resolves as `variant.priceOverride ?? variant.product.price` — the exact expression `createPendingOrder()` already uses. No FK to the paired `StockMovement`: a relation field would force a back-relation on `StockMovement`, and voiding writes its own compensating ledger row, so the link buys nothing. No index beyond `soldAt`/`variantId`: one physical store produces hundreds of rows per month, not millions.

### D2 — Void marking: nullable `voidedAt` timestamp

| Option | Tradeoff | Decision |
|---|---|---|
| `voidedAt DateTime?` | Carries *whether* and *when* in one column; `WHERE voidedAt IS NULL` is both the report filter and the double-void guard | **Chosen** |
| `status SaleStatus` enum | Needs a second column for the timestamp anyway; new enum for a two-state flag | Rejected |
| Compensating negative `Sale` row | Breaks "one row = one physical sale"; every count query must net; compensation already belongs in the ledger, not in the revenue table | Rejected |

Mirrors the codebase's existing nullable-timestamp-as-state idiom (`Order.expiresAt`, null once terminal).

### D3 — `PICKUP_CASH` method persistence: nullable `Order.paymentMethod`

| Option | Tradeoff | Decision |
|---|---|---|
| `Order.paymentMethod PaymentMethod?` | One additive nullable column; no join in the report; sits next to `Order.method` where staff already look | **Chosen** (confirms the proposal sketch) |
| Extend `Payment` | `mpPaymentId @unique` is the webhook idempotency guarantee (schema D4); making it nullable weakens it. `Payment` is MP-shaped, not a general payment record | Rejected |
| New `OrderPayment` table | A whole table and join for one enum on one order method | Rejected |
| Write a `Sale` row at pickup | Double-counts against `OrderItem`, and makes `Sale` mean two things | Rejected |

**Migration**: `ALTER TABLE "orders" ADD COLUMN "paymentMethod" "PaymentMethod";` — nullable, no default, no table rewrite.

**Backfill: none, deliberately.** Existing `PICKUP_CASH` orders in `PAID`/`PICKED_UP` have no recorded method and no source of truth anywhere; defaulting them to `CASH` would fabricate financial data. They surface in the report as an explicit fourth bucket, *Sin método registrado*. Same accepted-limitation category as the pre-ship-date `Sale` gap.

Enforcement is application-level (`markPickedUp()` rejects a `PICKUP_CASH` order without a method). A DB `CHECK ... NOT VALID` was considered and rejected: `NOT VALID` still fires on UPDATE of legacy rows, so any future touch of an old `PICKED_UP` order would start failing.

### D4 — Report revenue instant: the `StockMovement(PAID)` ledger row

`Order.createdAt` is when the order was *placed*, not when money changed hands — a Monday reservation paid on Wednesday would land on Monday's caja. `updatedAt` is overwritten by any later write. `commitPaid()` is, by construction, the single moment reserved-unpaid becomes sold-paid on **both** paths (MP webhook and pickup), and it already writes `StockMovement(reason=PAID, orderId, at)`. The report derives the order's revenue date from that row — historically accurate back to the first order, zero new columns, zero backfill. A new `Order.paidAt` column was rejected for requiring exactly that backfill (which would be computed from these same ledger rows anyway).

### D5 — Report day boundaries: fixed UTC−3

`business-days.ts` deliberately treats wall clock as UTC (documented MVP shortcut) because hold expiry only needs coarse day granularity. A financial day-close cannot tolerate that: a 21:30 ART sale is 00:30 UTC the next day and would be reported on the wrong day. New `src/lib/report-day.ts` resolves an `YYYY-MM-DD` to `Date.UTC(y, m, d, 3, 0, 0)`. Argentina has had no DST since 2009 and the app is single-locale es-AR, so a fixed offset is exact and needs no IANA dependency. This divergence from `business-days.ts` is intentional and documented in the module header.

### D6 — Payment-method UI: inline progressive disclosure, not a modal

| Option | Tradeoff | Decision |
|---|---|---|
| Inline two-button reveal in the action cell | Precedent exists (`AddVariantForm.tsx` inline row-form, `pedidos/page.tsx` `<details>`); no chrome, no focus trap, one extra click, works on mobile | **Chosen** |
| New `<dialog>` modal component | First modal in the codebase; focus trap, scroll lock, escape handling, overlay — new abstraction for two buttons | Rejected |
| `window.confirm`/`prompt` | Cannot present two typed choices; unstyled; blocks the thread | Rejected |

One shared presentational component `PaymentMethodChoice.tsx` (props: `label`, `pending`, `onChoose(method)`, `onCancel`) is consumed by both containers, which keep their own fetch/error state — the container-presentational split already visible across `admin/*` components. "Vender 1" becomes a toggle that reveals **Efectivo** / **Transferencia** / **Cancelar**; each choice fires the POST directly, so total clicks go 1 → 2. Copy is es-AR, active voice, identical in both places ("¿Cómo pagó?"). The revealed group is `role="group" aria-label="Método de pago"`, focus moves to the first choice, Escape collapses. `OrderPickupButton` takes a new `requiresPaymentMethod` prop — `pedidos/page.tsx` already has `order.method` in scope — so MP orders keep their current one-click behaviour untouched.

## Data Flow

```
CajaRowActions ──POST /api/admin/stock/sell──→ sale.service.recordInStoreSale()
                                                   │  one $transaction
                                                   ├─→ sellInStore()  → variants UPDATE + StockMovement(IN_STORE_SALE)
                                                   └─→ Sale.create()

OrderPickupButton ──POST /api/admin/orders/[id]/pickup {paymentMethod}──→ markPickedUp()
                                                   │  one $transaction
                                                   ├─→ commitPaid() per line → StockMovement(PAID)
                                                   └─→ Order.update(status, paymentMethod)

reportes/page.tsx ──→ getRevenueReport(from, to) ──→ Sale (voidedAt IS NULL)
                                                 └─→ StockMovement(PAID) → Order → OrderItem
```

## Sequence Diagrams

**(a) In-person sale with payment method**

```
Staff        CajaRowActions        /api/admin/stock/sell     sale.service        Postgres
  │  Vender 1 →│                          │                       │                  │
  │            │ reveal Efectivo/Transf.  │                       │                  │
  │ Efectivo → │ POST {variantId,qty,     │                       │                  │
  │            │       paymentMethod} ───→│ auth() + validate     │                  │
  │            │                          │ ─── recordInStore ───→│ BEGIN            │
  │            │                          │                       │ read variant     │
  │            │                          │                       │  (priceOverride  │
  │            │                          │                       │   ?? price)      │
  │            │                          │                       │ UPDATE variants  │
  │            │                          │                       │  SET onHand-=q   │
  │            │                          │                       │  WHERE onHand    │
  │            │                          │                       │   -held >= q     │
  │            │                          │                       │ ├ 0 rows → ROLLBACK, 409
  │            │                          │                       │ INSERT stock_movement(IN_STORE_SALE)
  │            │                          │                       │ INSERT sale(unitPrice, paymentMethod)
  │            │                          │←──── ok ──────────────│ COMMIT           │
  │            │←── 200 ──────────────────│                       │                  │
  │            │ router.refresh() → force-dynamic re-read of /admin/caja             │
```

**(b) Voiding a sale**

```
Staff     VoidSaleButton     /api/admin/sales/[id]/void     sale.service       Postgres
  │ Anular →│ confirm inline │                                    │               │
  │         │ POST ─────────→│ auth()                             │               │
  │         │                │ ──── voidSale({saleId,actor}) ────→│ BEGIN         │
  │         │                │                                    │ UPDATE sales SET voidedAt=now(),
  │         │                │                                    │   voidedById=$actor
  │         │                │                                    │  WHERE id=$id
  │         │                │                                    │    AND voidedAt IS NULL
  │         │                │                                    │    AND soldAt >= $startOfToday
  │         │                │                                    │ ├ 0 rows → ROLLBACK
  │         │                │                                    │    → re-read to classify:
  │         │                │                                    │      missing → 404
  │         │                │                                    │      voidedAt set → 409 already_voided
  │         │                │                                    │      old → 409 void_window_closed
  │         │                │                                    │ UPDATE variants SET onHand += qty
  │         │                │                                    │  WHERE id=$v
  │         │                │                                    │    AND onHand+qty >= held
  │         │                │                                    │    AND onHand+qty >= 0
  │         │                │                                    │ INSERT stock_movement(ADJUSTMENT, +qty)
  │         │                │←──────── ok ───────────────────────│ COMMIT        │
  │         │←─ 200 ─────────│  router.refresh()                  │               │
```

The claim UPDATE is the whole guard: it is atomic, so two concurrent voids cannot both match (the loser sees `voidedAt` already set and gets 409 — never a double restock). Honest finding: a **positive** restock can never violate `onHand >= held` or `onHand >= 0` (`adjust()`'s own doc comment proves this), so no SQL predicate can detect "stock already moved again" — the units are fungible. The protection must therefore be a business window, folded into the same claim: voiding is allowed only for sales from the current caja day (`soldAt >= startOfArgentinaDay(now)`), matching the report's day grain. Older mistakes go through the existing audited `adjust()` (+1) path in Caja, and the 409 message says exactly that.

**(c) `PICKUP_CASH` pickup with payment-method capture**

```
Staff     OrderPickupButton     /api/admin/orders/[id]/pickup    order.service      Postgres
  │ Marcar  │ method===PICKUP_CASH → reveal choices │                  │               │
  │ retirado│ (MP order → posts immediately, no prompt)                │               │
  │ Transf→ │ POST {paymentMethod:"TRANSFER"} ─────→│ auth(), parse    │               │
  │         │                                       │ (empty body ok)  │               │
  │         │                                       │ ─ markPickedUp ─→│ read order    │
  │         │                                       │                  │ PICKUP_CASH   │
  │         │                                       │                  │ && no method  │
  │         │                                       │                  │ && none given │
  │         │                                       │                  │  → 400 payment_method_required
  │         │                                       │                  │ BEGIN         │
  │         │                                       │                  │ commitPaid() per line
  │         │                                       │                  │  → StockMovement(PAID, at)
  │         │                                       │                  │ UPDATE orders SET
  │         │                                       │                  │  status=PICKED_UP,
  │         │                                       │                  │  expiresAt=null,
  │         │                                       │                  │  paymentMethod=$m
  │         │←──── 200 ─────────────────────────────│←─────────────────│ COMMIT        │
```

`markPickedUp(prisma, orderId, options?)` keeps the third parameter optional, so the existing MP/`PAID` branch and its tests compile unchanged. The requirement applies whenever `order.method === "PICKUP_CASH"` and `paymentMethod` is not already set — covering the `PAID` branch too, not just `RESERVED`.

**(d) Report query and aggregation**

```
/admin/reportes?desde=&hasta=   (server component, force-dynamic)
        │
        ├─ report-day.ts → [fromUtc, toUtcExclusive)   (UTC−3 day edges)
        │
        └─→ getRevenueReport(prisma, {from, to})
              │
              ├── Q1  sale.findMany({ voidedAt: null, soldAt: { gte, lt } })
              │        └─ reduce with Prisma.Decimal:  unitPrice × qty  → CASH | TRANSFER
              │
              ├── Q2  stockMovement.findMany({ reason: PAID, at: { gte, lt },
              │                                orderId: { not: null } },
              │                              distinct: ["orderId"])   ← dedupe: N lines = N rows
              │        └─ orderIds
              │
              └── Q3  order.findMany({ id: { in: orderIds },
                                       status: { in: [PAID, PICKED_UP] } },
                                     include items)
                       └─ per order, sum items (unitPrice × qty) ONCE, bucket by:
                             method=MP                         → MP
                             PICKUP_CASH + paymentMethod=CASH  → CASH      (merges with Q1 CASH)
                             PICKUP_CASH + TRANSFER            → TRANSFER  (merges with Q1 TRANSFER)
                             PICKUP_CASH + null                → UNKNOWN   (legacy, shown apart)
                       merge in memory → { CASH, TRANSFER, MP, UNKNOWN, grand }
```

**No double-counting, by construction**: `Sale` rows never reference an `Order`, so Q1 and Q3 are disjoint sets. Within Q2, one order writes one `StockMovement(PAID)` **per line**, so `distinct: ["orderId"]` is load-bearing — without it a three-line order would be summed three times. An order that is `PAID` and later `PICKED_UP` is still one row matched once by `status IN (PAID, PICKED_UP)`; that filter is a belt-and-braces guard, since `cancelOrder()` only accepts `PENDING_PAYMENT`/`RESERVED` and expiry never touches a committed order.

A single day is `from === to` — one code path, no day-vs-range branch. The UI defaults both inputs to today.

Money is summed with `Prisma.Decimal` in TypeScript rather than SQL `SUM(unitPrice * qty)`: Prisma's `groupBy._sum` cannot sum an expression, and an in-memory reduce matches `getCajaRows()`'s established multi-query-then-merge shape without introducing a `$queryRaw` **read** idiom (raw SQL is currently reserved for the conditional-UPDATE concurrency primitive). Exact, not floating point. Documented escape hatch: switch to `$queryRaw` aggregation if a range ever exceeds ~10k rows.

## File Changes

| File | Action | Description |
|---|---|---|
| `prisma/schema.prisma` | Modify | `PaymentMethod` enum, `Sale` model, `Order.paymentMethod?`, `Variant.sales`, `AdminUser.sales`/`voidedSales` back-relations |
| `prisma/migrations/**/migration.sql` | Create | Additive: enum, `sales` table + indexes, one nullable column on `orders` |
| `src/modules/sales/sale.service.ts` | Create | `recordInStoreSale()` (price resolution + `sellInStore()` + `Sale` in one tx), `voidSale()`, `SaleAlreadyVoidedError`, `SaleVoidWindowClosedError`, `SaleNotFoundError` |
| `src/modules/inventory/stock.service.ts` | Unchanged | `sellInStore()` keeps its stock-only contract; the new service composes it |
| `src/app/api/admin/stock/sell/route.ts` | Modify | Validate `paymentMethod` ∈ {CASH,TRANSFER}; call `recordInStoreSale()` |
| `src/app/api/admin/sales/[saleId]/void/route.ts` | Create | `auth()`, 200 / 404 / 409 |
| `src/modules/orders/order.service.ts` | Modify | `markPickedUp(prisma, orderId, options?)`; `PaymentMethodRequiredError` |
| `src/app/api/admin/orders/[orderId]/pickup/route.ts` | Modify | Tolerate empty body; parse optional `paymentMethod`; 400 on required-but-missing |
| `src/components/admin/PaymentMethodChoice.tsx` | Create | Shared presentational two-button choice |
| `src/components/admin/CajaRowActions.tsx` | Modify | "Vender 1" reveals the choice; POST carries the method |
| `src/components/admin/OrderPickupButton.tsx` | Modify | New `requiresPaymentMethod` prop; same choice component |
| `src/components/admin/VoidSaleButton.tsx` | Create | Inline confirm + POST to the void route |
| `src/app/admin/(console)/pedidos/page.tsx` | Modify | Pass `requiresPaymentMethod={order.method === "PICKUP_CASH"}` |
| `src/lib/report-day.ts` | Create | UTC−3 day-edge resolution for `YYYY-MM-DD` |
| `src/modules/reports/caja-report.service.ts` | Create | `getRevenueReport()` — Q1/Q2/Q3 + in-memory merge |
| `src/app/admin/(console)/reportes/page.tsx` | Create | Server component, `force-dynamic`, date-range form, totals table, today's sales list with Anular |
| `src/app/admin/(console)/layout.tsx` | Modify | Nav `<Link href="/admin/reportes">Reportes</Link>` |

## Interfaces / Contracts

```ts
// src/modules/sales/sale.service.ts
export interface RecordInStoreSaleParams {
  variantId: string; qty: number; paymentMethod: PaymentMethod; actorId?: string;
}
export function recordInStoreSale(prisma: PrismaClient, p: RecordInStoreSaleParams): Promise<Sale>;
export function voidSale(prisma: PrismaClient, p: { saleId: string; actorId?: string }): Promise<Sale>;

// src/modules/reports/caja-report.service.ts
export type RevenueBucket = "CASH" | "TRANSFER" | "MP" | "UNKNOWN";
export interface RevenueReport {
  from: Date; to: Date;                                  // half-open [from, to)
  totals: Record<RevenueBucket, Prisma.Decimal>;
  grandTotal: Prisma.Decimal;
  inPerson: Record<"CASH" | "TRANSFER", Prisma.Decimal>; // so the UI can show provenance
  fromOrders: Record<RevenueBucket, Prisma.Decimal>;
  counts: { sales: number; voidedSales: number; orders: number };
}
export function getRevenueReport(
  prisma: PrismaClient, range: { from: string; to: string },
): Promise<RevenueReport>;
```

HTTP contracts: `POST /api/admin/stock/sell` `{variantId, qty, paymentMethod}` → 200 | 400 `invalid_request` | 401 | 409 `out_of_stock`. `POST /api/admin/sales/[saleId]/void` `{}` → 200 | 401 | 404 `sale_not_found` | 409 `already_voided` | 409 `void_window_closed`. `POST /api/admin/orders/[orderId]/pickup` `{paymentMethod?}` → 200 | 400 `payment_method_required` | 401 | 404 | 409 `invalid_transition`.

Every new/modified route checks `auth()` inline — `src/proxy.ts`'s matcher does not cover `/api/admin/**`. Authorization is flat (any authenticated staff member may void any sale); acceptable for a single-store admin, and `voidedById` records who did it.

## Testing Strategy

Vitest (`npm test` → `vitest run`), Testing Library, Playwright for e2e. Service tests run against the real test DB (`npm run db:test:setup`).

| Layer | What to Test | Approach |
|---|---|---|
| Unit | `report-day.ts` UTC−3 edges incl. the 21:30-ART-is-next-UTC-day case | Pure function, fixed clock |
| Unit | Report bucketing/merge incl. `UNKNOWN` legacy bucket | Fake query results into the merge function |
| Integration | `recordInStoreSale()` writes `Sale` + `StockMovement` atomically; `OutOfStockError` rolls back **both** | Real tx, assert zero `Sale` rows after failure |
| Integration | `voidSale()` restocks exactly once; second call → `SaleAlreadyVoidedError`, `onHand` unchanged | Call twice, assert `onHand` delta is `+qty` total |
| Integration | Concurrent double-void: two parallel `voidSale()` → one 200, one 409, one restock | `Promise.allSettled` on the same saleId |
| Integration | Out-of-window void rejected, no restock | Seed `soldAt` = yesterday |
| Integration | `markPickedUp()` rejects `PICKUP_CASH` without method; persists it on success; MP branch unchanged | Existing `order.service` test file |
| Integration | Report excludes voided sales and never double-counts a multi-line order | Seed a 3-line PAID order, assert counted once |
| Component | `CajaRowActions` posts only after a method is chosen; `OrderPickupButton` prompts only for `PICKUP_CASH` | Testing Library, mock fetch |
| E2E | Sell → report shows it → void → report drops it and stock returns | Playwright against the admin console |

## Threat Matrix

N/A — no routing, shell, subprocess, VCS/PR automation, executable-file classification, or process-integration boundary. The new HTTP endpoints are in-application admin routes behind the existing `auth()` session check; their concrete requirements are stated in *Interfaces / Contracts* above.

## Migration / Rollout

One additive Prisma migration on the DonWeb VPS Postgres: create `PaymentMethod`, create `sales` + two indexes, add one nullable column to `orders`. No table rewrite, no lock beyond a brief `ACCESS EXCLUSIVE` for the `ADD COLUMN` (instant — nullable, no default). No backfill (D3). Deploy order: migrate, then ship app code; the old app code ignores both new structures, so the migration is safe to run ahead of the deploy. Rollback: revert app code and leave the schema in place (both additions are orphan-safe and no existing read path touches them); drop `sales` only before the first production sale.

## Open Questions

- [x] Void window is the current caja day (D3/diagram b). **Confirmed by owner**: a sale can only be voided the same caja day it was recorded; a mistake noticed later is corrected via a manual stock Ajuste, same as today.
- [ ] Report UI wording for the *Sin método registrado* bucket: show always, or only when non-zero for the selected range.
