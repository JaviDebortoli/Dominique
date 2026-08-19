# Tasks: Staff Order Cancellation

> Strict TDD active. Every implementation task is preceded by its RED test (written first, failing) — combined `RED→GREEN` lines, mirroring `2026-08-16-admin-categorias/tasks.md`.

## Review Workload Forecast

| Field | Value |
|-------|-------|
| Estimated changed lines | 550–700 (1 service addition + its unit tests, 1 new route + its integration tests, 1 new button + its component test, 1 page wiring diff, a doc-comment drive-by) |
| Session review budget | 800 lines |
| 800-line budget risk | Medium — comfortably under 800, but not "small enough to ignore"; bulk is hand-written test cases mirroring already-shipped patterns (`markPickedUp`/`pickup/route.test.ts`/`ProductRow.test.tsx`) |
| Chained PRs recommended | No — service → route → button → page wiring is a single sequential dependency chain with no independently mergeable mid-point |
| Suggested split | Single PR |
| Delivery strategy | ask-on-risk |
| Chain strategy | pending |

Decision needed before apply: No
Chained PRs recommended: No
Chain strategy: pending
800-line budget risk: Medium

**Per-file basis**: `order.service.ts` additions ~45 (`cancelOrder` + doc-comment cross-reference) / `order.service.test.ts` additions ~170 (6 cases: PENDING_PAYMENT, RESERVED, 4× blocked-status, unknown id) / `cancel/route.ts` ~60 / `cancel/route.test.ts` ~170 (mirrors `pickup/route.test.ts`'s 135 + PAID-message and generic-message 409 cases) / `OrderCancelButton.tsx` ~65 / `OrderCancelButton.test.tsx` ~100 / `pedidos/page.tsx` diff ~15.

### Suggested Work Units

| Unit | Goal | Likely PR | Focused test command | Runtime harness | Rollback boundary |
|------|------|-----------|----------------------|-----------------|-------------------|
| 1 | Full slice: service → route → button → page wiring | PR 1 | `npm test` (Vitest, full suite; real Postgres for service/route tests) | N/A — design.md Threat Matrix: no shell/subprocess/routing-dispatch boundary; existing manual admin flow (`/admin/pedidos`) is sufficient, no new e2e spec in design's File Changes | Revert the PR: `cancelOrder`, `cancel/route.ts`, `OrderCancelButton.tsx` all disappear; `pedidos/page.tsx` reverts to pickup-only; already-cancelled orders remain ordinary `CANCELLED` rows (design.md Migration/Rollout) |

## Phase 1: Service Layer — `cancelOrder`

- [x] 1.1 RED: extend `src/modules/orders/order.service.test.ts` — new `describe("cancelOrder …")`: `PENDING_PAYMENT→CANCELLED` releases every line's `held` (assert `StockMovement(RELEASE)` per item, `onHand` untouched, `expiresAt: null`); `RESERVED→CANCELLED` same assertions on a multi-line order; `PAID`/`PICKED_UP`/`EXPIRED`/already-`CANCELLED` each throw `InvalidOrderStatusTransitionError` and mutate nothing; unknown `orderId` throws `OrderNotFoundError`.
- [x] 1.2 GREEN: add `cancelOrder(prisma, orderId)` to `order.service.ts` beside `markPickedUp` — positive guard (`PENDING_PAYMENT`/`RESERVED`) → one `$transaction` (`release(tx, …)` per item, then `order.update({ status: "CANCELLED", expiresAt: null })`) → fallthrough `throw new InvalidOrderStatusTransitionError(...)`; extend `confirmPaymentApproved`'s block comment (design.md "Webhook race" decision) and add a one-line cross-reference in `cancelOrder`'s own doc comment.

## Phase 2: Route Layer

- [x] 2.1 RED: create `src/app/api/admin/orders/[orderId]/cancel/route.test.ts` (mirrors `pickup/route.test.ts`: `makeAuthMockModule`, real Postgres, `ctx()`/`afterAll` cleanup) — 401 unauthenticated leaves order untouched; 200 cancels a `PENDING_PAYMENT`/`RESERVED` order; 404 unknown id; 409 on `PAID` returns the MercadoPago message verbatim; 409 on already-`CANCELLED` returns the generic message — assert `body.message` exactly plus unchanged row for both 409 cases.
- [x] 2.2 GREEN: create `src/app/api/admin/orders/[orderId]/cancel/route.ts` (mirrors `pickup/route.ts`) — `auth()` 401 gate, `cancelOrder(prisma, orderId)`, catch `OrderNotFoundError`→404, catch `InvalidOrderStatusTransitionError`→409 branching on `error.fromStatus === "PAID"` for the Spanish message (design.md Interfaces/Contracts route status map).

## Phase 3: UI — Cancel Button

- [x] 3.1 RED: create `src/components/admin/OrderCancelButton.test.tsx` (mirrors `ProductRow.test.tsx`: stubbed `fetch`, stubbed `window.confirm`, mocked `next/navigation` `useRouter`) — `confirm()` false → no fetch call; true → POST to `/api/admin/orders/{orderId}/cancel` + `router.refresh()`; non-ok response renders `body.message` inside `role="alert"`.
- [x] 3.2 GREEN: create `src/components/admin/OrderCancelButton.tsx` — `{ orderId, publicCode }` props, `window.confirm(\`¿Cancelar el pedido ${publicCode}?\`)`, POST fetch, borderless destructive styling (`font-sans text-label-caps uppercase tracking-widest text-red-700`, matching `ProductRow`'s "Eliminar").

## Phase 4: Wiring — Admin Orders List

- [x] 4.1 GREEN: `src/app/admin/(console)/pedidos/page.tsx` — add `CANCEL_ELIGIBLE: OrderStatus[] = ["PENDING_PAYMENT", "RESERVED"]`, wrap the action cell in `<div className="flex flex-col items-end gap-2">` with pickup button then conditional `<OrderCancelButton orderId={order.id} publicCode={order.publicCode} />`. Visibility for `RESERVED` (both buttons) and non-eligible statuses (neither) verified manually against spec's "Cancel affordance visibility" scenario — no dedicated page test exists for the sibling `PICKUP_ELIGIBLE` array either; Phase 3's component test already covers the button's own behavior.

## Post-Verify Remediation

- [x] 4.2 RED→GREEN: `src/app/admin/(console)/pedidos/page.test.tsx` — closes sdd-verify's CRITICAL finding on task 4.1's manual-only verification. Renders the real `AdminOrdersPage` RSC directly (mirrors `/pedido/[code]/page.test.tsx`'s precedent) against real-Postgres orders seeded in every `OrderStatus`, asserting `Cancelar` renders only for `PENDING_PAYMENT`/`RESERVED` (including the `RESERVED` both-buttons case) and is hidden for `PAID`/`PICKED_UP`/`EXPIRED`/`CANCELLED`. RED confirmed first (missing `next/navigation` mock for the client button descendants → `invariant expected app router to be mounted`), then GREEN after adding the mock (mirrors `OrderCancelButton.test.tsx`'s convention). Commit `c9d8003` on `feat/admin-cancelar-pedido` (new commit, `8bdba7b` untouched).

## Open Items Carried Forward (from design.md)

- Refunding a `PAID` order stays manual via the MercadoPago dashboard — out of scope, explicitly named in the 409 message.
