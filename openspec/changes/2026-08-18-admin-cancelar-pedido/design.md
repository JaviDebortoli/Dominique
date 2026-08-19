# Design: Staff Order Cancellation

## Technical Approach

`cancelOrder(prisma, orderId)` joins `order.service.ts` beside `markPickedUp`, reusing its skeleton (`findOrderOrThrow` → positive status branch → fallthrough `throw`) and `compensateFailedPreference`'s body (`release(tx, …)` per item, then the status write, one `$transaction`). A thin POST route mirrors `pickup/route.ts`; a `confirm()`-gated client button mirrors `OrderPickupButton` plus `ProductRow`'s destructive-action convention. Additive only: no migration, no change to any existing read or write path.

## Architecture Decisions

### Decision: Positive-guard branch order, one shared branch for both sources

**Choice**: `if (status === "PENDING_PAYMENT" || status === "RESERVED") { release-all + update }`, then `throw new InvalidOrderStatusTransitionError(orderId, status, "CANCELLED")`.
**Alternatives considered**: negative guard first (throw for `PAID`/`PICKED_UP`/`EXPIRED`/`CANCELLED`, then handle the rest); two separate branches like `markPickedUp`.
**Rationale**: the positive guard fails closed — a future `OrderStatus` member is rejected, not silently cancelled, which a negative guard's enumerated deny-list would let through. One shared branch is correct because both valid sources hold stock **only** via `held` with `onHand` never decremented, so the release path is byte-identical; `markPickedUp` needed two branches only because `PAID` and `RESERVED` differ in stock semantics.

### Decision: Reuse `InvalidOrderStatusTransitionError`; the route composes the Spanish copy

**Choice**: the service throws the existing error (English, technical, carrying `fromStatus`). The route branches on `error.fromStatus === "PAID"` to select the message.
**Alternatives considered**: a new `OrderAlreadyPaidError`; the service throwing the Spanish string directly.
**Rationale**: the project's established convention — service errors are English/technical, routes compose Spanish user copy (`pickup/route.ts`, product/variant delete routes). `fromStatus` is already a public readonly field, so the route needs no new type. A second error class would encode presentation branching into the domain for what is one transition rule.

### Decision: Own `$transaction`, `release()` called with `tx`, default `RELEASE` reason

**Choice**: `prisma.$transaction(async (tx) => …, { maxWait: 10_000, timeout: 10_000 })`, `release(tx, { variantId, qty, orderId })`.
**Alternatives considered**: sequential non-transactional calls; a new `StockMovementReason.STAFF_CANCEL`.
**Rationale**: `release()`'s parameter type is `StockClient = Pick<PrismaClient, "$executeRaw"> & { stockMovement: { create } }` — the `tx` callback param satisfies it exactly (same call shape as `compensateFailedPreference` and `confirmPaymentRejectedOrCancelled`). All-or-nothing matters: a partial release would leave stock and status disagreeing. A new enum member is a schema migration, ruled out of scope; `orderId` + `Order.status` reconstructs staff-cancel vs. payment-rejection from the ledger.

### Decision: Stacked action cell, cancel styled as destructive text

**Choice**: `<div className="flex flex-col items-end gap-2">` wrapping pickup then cancel. Cancel uses `font-sans text-label-caps uppercase tracking-widest text-red-700` (borderless), matching `ProductRow`'s "Eliminar".
**Alternatives considered**: side-by-side buttons; a bordered cancel matching pickup.
**Rationale**: `OrderPickupButton` already renders `flex flex-col items-end gap-1` with its own inline `role="alert"`; side-by-side would make two error paragraphs compete in a narrow cell. `RESERVED` is the only status showing both, and the borderless red visually subordinates the destructive action to the primary one.

### Decision: Webhook race documented in both doc comments

**Choice**: extend `confirmPaymentApproved`'s existing block comment (above line 296) noting that `tx.payment.create()` runs **before** the `existingOrder.status !== "PENDING_PAYMENT"` guard, so a late `approved` payment for a staff-cancelled order still records its `Payment` row (correct — money moved) while the order stays `CANCELLED` with stock released; reconcile via that row plus the MP dashboard. Add a one-line cross-reference in `cancelOrder`'s doc comment.
**Alternatives considered**: a single comment in one place; inline comments at the statements.
**Rationale**: discovery is bidirectional — a reader arrives from either the webhook or the admin side. The codebase documents in block comments above functions, not inline.

## Data Flow

    OrderCancelButton ──POST /api/admin/orders/[id]/cancel──→ auth()
                                                                │
                                    cancelOrder(prisma, orderId)│
                                                                ▼
                              $transaction ─→ release(tx) per item ─→ StockMovement(RELEASE)
                                           └→ order.update(CANCELLED, expiresAt: null)
                                                                │
              router.refresh() ←──── 200 {id,status} ───────────┘
                                     404 / 409 / 401 → inline alert

## File Changes

| File | Action | Description |
|------|--------|-------------|
| `src/modules/orders/order.service.ts` | Modify | Add `cancelOrder`; extend `confirmPaymentApproved` doc with the race note |
| `src/app/api/admin/orders/[orderId]/cancel/route.ts` | Create | POST adapter, own `auth()` gate |
| `src/components/admin/OrderCancelButton.tsx` | Create | `confirm()`-gated client button |
| `src/app/admin/(console)/pedidos/page.tsx` | Modify | `CANCEL_ELIGIBLE` + stacked action cell |
| `src/modules/orders/order.service.test.ts` | Modify | `cancelOrder` describe block |
| `src/app/api/admin/orders/[orderId]/cancel/route.test.ts` | Create | Integration tests |
| `src/components/admin/OrderCancelButton.test.tsx` | Create | Component tests |

## Interfaces / Contracts

```ts
export async function cancelOrder(prisma: PrismaClient, orderId: string): Promise<PendingOrder>;

// pedidos/page.tsx
const CANCEL_ELIGIBLE: OrderStatus[] = ["PENDING_PAYMENT", "RESERVED"];

// OrderCancelButton.tsx — needs publicCode for the confirm copy
export function OrderCancelButton({ orderId, publicCode }: { orderId: string; publicCode: string });
window.confirm(`¿Cancelar el pedido ${publicCode}?`);
```

Route status map (`RouteContext { params: Promise<{ orderId: string }> }`):

| Condition | Status | Body |
|---|---|---|
| no `session?.user` | 401 | `{ error: "unauthenticated" }` |
| `OrderNotFoundError` | 404 | `{ error: "order_not_found" }` |
| `InvalidOrderStatusTransitionError`, `fromStatus === "PAID"` | 409 | `message: "No se puede cancelar: ya está pagado. Para reembolsar, gestionalo desde MercadoPago."` |
| `InvalidOrderStatusTransitionError`, other | 409 | `message: "No se puede cancelar un pedido en este estado."` |
| success | 200 | `{ id, status }` |

## Testing Strategy

| Layer | What to Test | Approach |
|-------|-------------|----------|
| Unit (service, real Postgres) | `PENDING_PAYMENT → CANCELLED` releases every line's `held`, `onHand` untouched, `expiresAt: null` | New `describe("cancelOrder …")` in `order.service.test.ts`, mirroring the `markPickedUp` block |
| Unit | `RESERVED → CANCELLED` behaves identically (triangulation, multi-line order) | Assert `held` per variant + one `StockMovement(RELEASE)` row per item |
| Unit | `PAID`, `PICKED_UP`, `EXPIRED`, already-`CANCELLED` throw and mutate nothing | Assert throw + unchanged status/`held` |
| Unit | Unknown `orderId` throws `OrderNotFoundError` | Same shape as `markPickedUp`'s case |
| Integration | 401 unauthenticated leaves the order untouched; 200 cancels; 404 unknown id | `cancel/route.test.ts` mirroring `pickup/route.test.ts` (`makeAuthMockModule`, `ctx()`, real DB, `afterAll` cleanup) |
| Integration | 409 on a `PAID` order returns the MercadoPago message verbatim; 409 on `CANCELLED` returns the generic one | Assert `body.message` exactly, plus unchanged row |
| Component | `confirm()` false → no fetch; true → POST + `router.refresh()`; non-ok → `role="alert"` with `body.message` | Vitest + Testing Library, mirroring `ProductRow.test.tsx`'s `window.confirm` mock |
| Component/page | Button renders only for `PENDING_PAYMENT`/`RESERVED`; `RESERVED` shows both buttons | Assert on the rendered action cell |

## Threat Matrix

N/A — no shell, subprocess, VCS/PR automation, executable-file classification, or process-integration boundary. The new Next.js API route is in-process HTTP handling, not a routing/dispatch boundary of the kind this matrix covers.

## Migration / Rollout

No migration required. No schema change, no `StockMovementReason` member, no backfill. Revert the PR to remove the feature; already-cancelled orders remain ordinary `CANCELLED` rows.

## Open Questions

- [ ] None — all proposal decisions and refinements were resolved by the owner before this phase.
