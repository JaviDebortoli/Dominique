# Delta for order-lifecycle

**Type**: Delta — modifies the existing `order-lifecycle` capability. `PICKUP_CASH` pickups now require an explicit payment-method choice (CASH or TRANSFER) at the "Marcar retirado" moment, since `markPickedUp()` is the actual payment-commit point for that order method.

## MODIFIED Requirements

### Requirement: Staff-Driven Status Transitions

Staff MUST be able to transition an order's status (e.g. mark ready, mark picked up, cancel) from the admin console.

Staff MUST be able to cancel an order from `/admin/pedidos` only when its status is `PENDING_PAYMENT` or `RESERVED`. Cancellation MUST, in one transaction, release each item's `held` stock, set `status: CANCELLED`, clear `expiresAt`, and write a `StockMovement` row per released item. Cancelling from any other status MUST be rejected with `409` and MUST NOT mutate anything; a `PAID` order's message MUST explicitly name MercadoPago as the refund path. The action MUST require authentication, MUST reject unknown order ids with `404`, and its affordance MUST render only for eligible statuses.

When staff mark a `PICKUP_CASH` order picked up — the `RESERVED → PICKED_UP` transition, which is the moment `markPickedUp()` commits payment for that order method — the action MUST require an explicit payment-method selection, CASH or TRANSFER, as a genuine choice made at that moment, not merely a confirmation of an assumed prior transfer. "Marcar retirado" MUST NOT complete for a `PICKUP_CASH` order without that selection, and the selected method MUST be persisted on the order for revenue reporting. This requirement does not apply to the MP path, where payment already occurred via the webhook before pickup.

(Previously: covered mark-picked-up and cancel transitions only, with no payment-method capture requirement for `PICKUP_CASH` pickups.)

#### Scenario: Staff marks an MP order picked up (unaffected)

- GIVEN an order is `PAID` via the MercadoPago path
- WHEN staff mark it picked up
- THEN the order SHALL move to `PICKED_UP` with no payment-method prompt, since payment already occurred at the webhook

#### Scenario: PICKUP_CASH pickup requires a payment-method choice

- GIVEN a `PICKUP_CASH` order is `RESERVED`
- WHEN staff open "Marcar retirado" for it
- THEN they MUST be prompted to choose "Efectivo" or "Transferencia" before the pickup can complete

#### Scenario: Pickup blocked without a payment-method selection

- GIVEN a `PICKUP_CASH` order is `RESERVED` and staff have opened "Marcar retirado"
- WHEN staff attempt to confirm without selecting a payment method
- THEN the system MUST block the request and MUST NOT transition the order to `PICKED_UP`

#### Scenario: Selected payment method persists for reporting

- GIVEN staff mark a `PICKUP_CASH` order picked up and select "Transferencia"
- WHEN the transition completes
- THEN the order's payment method MUST be persisted as TRANSFER and MUST be included as transferencia revenue in the revenue report

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
