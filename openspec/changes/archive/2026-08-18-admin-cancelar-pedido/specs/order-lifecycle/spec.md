# Delta for order-lifecycle

**Type**: Delta — modifies the existing `order-lifecycle` capability (no new capability domain). Fills in the "cancel" scenario already named in prose in "Staff-Driven Status Transitions", with no scenario until now.

## MODIFIED Requirements

### Requirement: Staff-Driven Status Transitions

Staff MUST be able to transition an order's status (e.g. mark ready, mark picked up, cancel) from the admin console.

Staff MUST be able to cancel an order from `/admin/pedidos` only when its status is `PENDING_PAYMENT` or `RESERVED`. Cancellation MUST, in one transaction, release each item's `held` stock, set `status: CANCELLED`, clear `expiresAt`, and write a `StockMovement` row per released item. Cancelling from any other status MUST be rejected with `409` and MUST NOT mutate anything; a `PAID` order's message MUST explicitly name MercadoPago as the refund path. The action MUST require authentication, MUST reject unknown order ids with `404`, and its affordance MUST render only for eligible statuses.

(Previously: cancel was named in prose with no scenario. This adds the cancel behavior: valid sources, stock release, audit trail, blocked-status rejection with MercadoPago copy for `PAID`, auth/not-found handling, and button visibility.)

#### Scenario: Staff marks order picked up

- GIVEN an order is `ready for pickup`
- WHEN staff marks it `picked up`
- THEN the order SHALL move to its terminal fulfilled state and its stock MUST NOT be affected again

#### Scenario: Staff cancels a PENDING_PAYMENT order

- GIVEN an order has status `PENDING_PAYMENT` with stock held for its items
- WHEN staff cancels it from `/admin/pedidos`
- THEN its status SHALL become `CANCELLED`, `expiresAt` SHALL be cleared, and each item's held stock SHALL be released to availability
- AND a `StockMovement` row SHALL be written per released item

#### Scenario: Staff cancels a RESERVED order

- GIVEN an order has status `RESERVED` with stock held for its items
- WHEN staff cancels it from `/admin/pedidos`
- THEN its status SHALL become `CANCELLED`, `expiresAt` SHALL be cleared, and each item's held stock SHALL be released to availability
- AND a `StockMovement` row SHALL be written per released item

#### Scenario: Cancel blocked for a PAID order

- GIVEN an order has status `PAID`
- WHEN staff attempts to cancel it
- THEN the system MUST respond `409 Conflict` with a message that explicitly names MercadoPago as the refund path (e.g. "No se puede cancelar: ya está pagado. Para reembolsar, gestionalo desde MercadoPago.")
- AND MUST NOT change the order's status or any stock

#### Scenario: Cancel blocked for a terminal-state order

- GIVEN an order has status `PICKED_UP`, `EXPIRED`, or already `CANCELLED`
- WHEN staff attempts to cancel it
- THEN the system MUST respond `409 Conflict`
- AND MUST NOT change the order's status or any stock

#### Scenario: Unauthenticated cancel request

- GIVEN the caller has no valid session
- WHEN they call `POST /api/admin/orders/[orderId]/cancel` directly
- THEN the system MUST respond `401 Unauthorized` as JSON
- AND MUST NOT mutate the order or any stock

#### Scenario: Cancel targets an unknown order id

- GIVEN no order exists with the given id
- WHEN staff (or a direct API call) attempts to cancel it
- THEN the system MUST respond `404 Not Found`

#### Scenario: Cancel affordance visibility on the admin orders list

- GIVEN an order row is rendered on `/admin/pedidos`
- WHEN the order's status is `PENDING_PAYMENT` or `RESERVED`
- THEN the cancel action SHALL be visible for that row
- AND for any other status, the cancel action SHALL be hidden, matching the pickup-button convention

#### Scenario: Customer order lookup reflects a staff cancellation (no new behavior)

- GIVEN an order was cancelled via the staff action rather than the webhook or expiry sweep
- WHEN a customer looks it up at `/pedido/[code]`
- THEN the page SHALL display "Cancelado" via its existing status-rendering logic, unchanged by this capability
