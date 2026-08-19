# Exploration: Manual order cancellation for staff (`/admin/pedidos`)

## Current State

No `cancelOrder()` function exists anywhere. Every existing transition to `CANCELLED` is code-internal, never staff-triggered:
- `confirmPaymentRejectedOrCancelled()` — `src/modules/orders/order.service.ts:347` — webhook-driven, guarded on `status === "PENDING_PAYMENT"`.
- `compensateFailedPreference()` — `src/app/api/checkout/route.ts:127` — runs only when MP preference creation itself fails.
- The 15-min cron sweep in `src/jobs/expire-reservations.ts` — moves expired orders to `EXPIRED`, not `CANCELLED`.

`/admin/pedidos` (`src/app/admin/(console)/pedidos/page.tsx`) only renders `OrderPickupButton` for `PICKUP_ELIGIBLE = ["PAID", "RESERVED"]` — no cancel column, no `CANCEL_ELIGIBLE` array.

## Affected Areas

- `src/modules/orders/order.service.ts` — add `cancelOrder(prisma, orderId)`. `compensateFailedPreference()` (checkout/route.ts:127-140) is the exact `release()`-per-item + `status: "CANCELLED", expiresAt: null` shape to mirror. `markPickedUp()` (order.service.ts:440-468) is the exact status-branch + `InvalidOrderStatusTransitionError` fallthrough shape to mirror.
- `src/app/api/admin/orders/[orderId]/cancel/route.ts` (new) — thin adapter mirroring `pickup/route.ts` (own `auth()` check, 404/409 mapping).
- `src/components/admin/OrderCancelButton.tsx` (new) — mirrors `OrderPickupButton.tsx`, but adds `window.confirm()` per the codebase's destructive-action convention (`ProductRow.tsx`, `VariantRow.tsx`) — `OrderPickupButton` itself has no confirmation, which is right for its low-risk action but wrong to copy for cancel.
- `src/app/admin/(console)/pedidos/page.tsx` — add `CANCEL_ELIGIBLE` array, render the new button.
- `src/app/(store)/pedido/[code]/page.tsx` — no change needed; `"Cancelado"` label and its test already exist and are status-agnostic to how `CANCELLED` was reached.
- `openspec/specs/order-lifecycle/spec.md` — "Staff-Driven Status Transitions" prose already names "cancel" but has zero written Scenario for it; needs a spec delta.
- `openspec/specs/admin-console/spec.md` — "Order Status Management" is generic enough it may need no wording change.

## Open Question 1 — Which statuses can be manually cancelled? (the real business question)

`PENDING_PAYMENT`/`RESERVED` are safe (stock only `held`, no `Payment` row yet). `PAID` is genuinely risky: exhaustive search of `src/modules/payments/` found **no refund mechanism anywhere** — `MercadoPagoClient` exposes exactly `createPreference` and `getPayment`, nothing refund-related. Cancelling a `PAID` order would flip status while MercadoPago still holds the customer's money, with `onHand` already decremented via `commitPaid()`. Recommend blocking `PAID` from manual cancellation (same fallthrough as `PICKED_UP`/`EXPIRED`/`CANCELLED`), pointing staff to MercadoPago's dashboard for refunds — but this is a product decision to confirm before `sdd-propose`.

## Open Question 2 — Idempotency

Mirror `markPickedUp`'s convention exactly: throw `InvalidOrderStatusTransitionError` (→ HTTP 409) for any status outside `PENDING_PAYMENT`/`RESERVED`, rather than a silent no-op — consistent with the existing tested pattern.

## Open Question 3 — Customer-facing page

Confirmed no change needed — already handled and tested.

## Open Question 4 — Webhook race (real risk, worth flagging in the proposal)

`confirmPaymentApproved()` (order.service.ts:296-337) writes the `Payment` row as the **first, unconditional** statement in its transaction — the `status !== "PENDING_PAYMENT"` check only gates stock/status updates afterward. So if staff cancel a `PENDING_PAYMENT` order at the same moment MercadoPago reports a late `approved` payment, a `Payment` row gets created for money the customer was charged, while the order stays `CANCELLED` and released stock may already be re-sold. No code currently defends against this. Same underlying gap as Question 1 (no refund flow) — should be an explicit accepted-risk or follow-up decision in the proposal, not silently ignored.

## Open Question 5 — UI shape

Simple `window.confirm()` + button, no reason/note field — no schema support or precedent exists for capturing a cancellation reason; treat as future scope, not default.

## Test conventions to mirror

- `order.service.test.ts`'s `describe("markPickedUp — terminal state transition (task 6.7)")`.
- `pickup/route.test.ts` (401/200/409/404 integration shape against real Postgres, `vi.mock("@/lib/auth", ...)`).

## Recommendation

Add `cancelOrder()` as a `PENDING_PAYMENT`/`RESERVED`-only transition mirroring `compensateFailedPreference` + `markPickedUp`'s branch/throw shape, block `PAID` and all terminal statuses with `InvalidOrderStatusTransitionError`, wire a thin route + confirm-gated button following existing pickup/delete conventions exactly, and explicitly document the webhook-race risk as an accepted MVP limitation in the proposal rather than silently shipping around it.

## Open Decisions — RESOLVED (owner, before proposal)

- **Cancel a PAID order**: blocked. No refund mechanism exists anywhere in the codebase; cancelling a paid order would leave the customer's money in MercadoPago with no matching system record. Staff handle refunds manually through MercadoPago's own dashboard, outside this app. `cancelOrder()` only transitions from `PENDING_PAYMENT`/`RESERVED`.
- **Webhook race (late `approved` arriving right after a manual cancel)**: accepted as a known limitation, documented in code, not mitigated in this change. The window is small and low-impact at current store volume; adding locking/retry machinery here would be disproportionate scope for a "let staff release a stuck reservation" feature.

## Ready for Proposal

Yes.
