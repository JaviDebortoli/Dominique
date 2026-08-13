# Order Lifecycle Specification

## Purpose

Defines the order status state machine and how customers and staff observe/transition it, without automated notifications in the MVP.

## Requirements

### Requirement: Order State Machine

An order MUST progress through: `pending` → (`paid` | `reserved`) → `ready for pickup` → (`picked up` | `cancelled`/`expired`).

#### Scenario: MercadoPago path

- GIVEN a customer pays online
- WHEN the webhook confirms payment
- THEN the order SHALL transition from `pending` to `paid`

#### Scenario: Cash/transfer path

- GIVEN a customer chooses pickup reservation
- WHEN the order is created
- THEN the order SHALL transition from `pending` to `reserved`

### Requirement: No Automated Pickup-Ready Notification (MVP)

The system MUST NOT send automated email or WhatsApp notifications when an order becomes ready for pickup. Status visibility is limited to the site/order lookup.

#### Scenario: Staff marks order ready

- GIVEN staff updates an order to `ready for pickup` in the admin console
- WHEN the update is saved
- THEN the system MUST NOT trigger any outbound customer notification

### Requirement: Status Visible via Order Lookup

Customers MUST be able to check current order status without an account, via an order-reference lookup.

#### Scenario: Customer checks status

- GIVEN a customer has an order reference/number
- WHEN they enter it in the order lookup flow
- THEN the system SHALL display the current status in Spanish (es-AR), e.g. "Pendiente", "Pagado", "Reservado", "Listo para retirar", "Retirado", "Cancelado", "Vencido"

### Requirement: Staff-Driven Status Transitions

Staff MUST be able to transition an order's status (e.g. mark ready, mark picked up, cancel) from the admin console.

#### Scenario: Staff marks order picked up

- GIVEN an order is `ready for pickup`
- WHEN staff marks it `picked up`
- THEN the order SHALL move to its terminal fulfilled state and its stock MUST NOT be affected again
