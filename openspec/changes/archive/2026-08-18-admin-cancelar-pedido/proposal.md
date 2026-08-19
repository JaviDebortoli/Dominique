# Proposal: Staff Order Cancellation

## Intent

`docs/bugs.md` — staff cannot cancel an order. Every transition to `CANCELLED` today is code-internal: the MercadoPago webhook, `compensateFailedPreference()`, and the 15-minute sweep (which writes `EXPIRED`, not `CANCELLED`). When a customer phones to drop a `PICKUP_CASH` reservation, the shop has no way to release that `held` stock before it expires on its own — 1–3 days if the reservation lands on a Friday or holiday. Stock stays unsellable while the order still reads "Reservado" to a customer who already backed out. `/admin/pedidos` offers only "marcar retirado".

## Scope

### In Scope

- `cancelOrder(prisma, orderId)` — `release()` per item, then `status: "CANCELLED", expiresAt: null`, in one `$transaction`
- Valid sources: `PENDING_PAYMENT`, `RESERVED`. Any other status throws `InvalidOrderStatusTransitionError`
- `POST /api/admin/orders/[orderId]/cancel` — thin adapter, own `auth()` gate, 401/404/409
- `OrderCancelButton.tsx` — `confirm()`-gated, per the codebase's destructive-action convention
- `CANCEL_ELIGIBLE = ["PENDING_PAYMENT", "RESERVED"]` + button on `/admin/pedidos`
- `order-lifecycle` spec delta

### Out of Scope

- Cancelling a `PAID` order — explicitly blocked
- Any refund mechanism; `MercadoPagoClient` exposes only `createPreference`/`getPayment`
- A cancellation reason/note field; any schema migration
- Mitigating the webhook race (documented in code, not defended)
- `/pedido/[code]` — already renders "Cancelado"

## Capabilities

### New Capabilities

- None

### Modified Capabilities

- `order-lifecycle`: "Staff-Driven Status Transitions" names cancel in its prose but has no scenario. Add staff cancellation of a `PENDING_PAYMENT`/`RESERVED` order with stock returned to availability, plus rejection of every other source status.

## Approach

Mirror two shipped shapes. `compensateFailedPreference()` gives the body: `release(tx, {variantId, qty, orderId})` per item, then the status write, one transaction. `markPickedUp()` gives the skeleton: `findOrderOrThrow` → branch on status → throw on fallthrough. Both valid sources hold stock only via `held` and never decremented `onHand`, so the release path is identical for both — simpler than `markPickedUp`. The route mirrors `pickup/route.ts`; `/api/admin/*` sits outside `proxy.ts`'s matcher, so it checks its own session.

## Affected Areas

| Area | Impact | Description |
|------|--------|-------------|
| `src/modules/orders/order.service.ts` | Modified | Add `cancelOrder` |
| `src/app/api/admin/orders/[orderId]/cancel/route.ts` | New | POST adapter |
| `src/components/admin/OrderCancelButton.tsx` | New | `confirm()`-gated client button |
| `src/app/admin/(console)/pedidos/page.tsx` | Modified | `CANCEL_ELIGIBLE` + button |
| `prisma/schema.prisma` | Unchanged | No migration |

## Risks

| Risk | Likelihood | Mitigation |
|------|------------|------------|
| Staff expect to cancel a `PAID` order and cannot | High | Accepted. 409 copy points at the MercadoPago dashboard for refunds |
| Webhook race: late `approved` payment lands after cancel; `confirmPaymentApproved()` writes its `Payment` row before checking status | Low | Accepted limitation, documented in code. Reconcile via the `Payment` row + MP dashboard |
| Released stock is re-sold before staff notice a mismatch | Low | Same manual remedy; volume is small |
| Double-click or stale page cancels twice | Low | Second call throws → 409, mutates nothing |

## Rollback Plan

Additive only — no migration, no change to any existing read or write path. Revert the PR: the route, button, `CANCEL_ELIGIBLE`, and `cancelOrder` disappear. Orders already cancelled remain ordinary `CANCELLED` rows, indistinguishable from webhook-cancelled ones, with their stock already released.

## Dependencies

- None. Uses shipped auth, Prisma client, `release()`, and Editorial Minimalist tokens.

## Success Criteria

- [ ] Owner cancels a `RESERVED` `PICKUP_CASH` order from `/admin/pedidos` and its `held` stock returns to availability immediately
- [ ] Cancelling a `PENDING_PAYMENT` order behaves identically
- [ ] `PAID`, `PICKED_UP`, `EXPIRED`, and already-`CANCELLED` orders return 409 and mutate nothing
- [ ] A `StockMovement` audit row is written per released item
- [ ] The cancel button renders only for eligible statuses and requires confirmation
- [ ] Unauthenticated POST returns JSON 401 and mutates nothing
- [ ] The customer's `/pedido/[code]` shows "Cancelado"

## Open Decisions — RESOLVED (owner, before spec/design)

- **Valid sources**: `PENDING_PAYMENT` and `RESERVED` only.
- **`PAID`**: blocked. No refund mechanism exists; staff refund through MercadoPago's own dashboard, outside this app. Not a gap to close here.
- **Webhook race**: accepted known limitation, documented in code comments. Locking or retry machinery is disproportionate at current volume.
- **Reason/note field**: out of scope; no precedent in any admin action.

## Refinements — RESOLVED (owner, before spec/design)

- **Blocked-cancel copy**: the `409` message for a `PAID`/terminal order explicitly names MercadoPago as the refund path, e.g. `"No se puede cancelar: ya está pagado. Para reembolsar, gestionalo desde MercadoPago."` — not a generic message.
- **Cancel button affordance**: hidden for ineligible statuses (`CANCEL_ELIGIBLE` gating), same convention as the existing "marcar retirado" button — NOT the always-clickable-then-error shape used for product/variant delete. Justified because the block reason here is always the same (wrong status), unlike products/variants which had several distinct causes worth surfacing after the click.
- **Confirmation wording**: generic (`"¿Cancelar el pedido {code}?"`), does NOT mention the stock-release consequence explicitly.
