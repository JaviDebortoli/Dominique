# Cart & Checkout Specification

## Purpose

Defines cart behavior and the pickup-only, guest-only checkout flow, including the choice between online payment and cash/transfer reservation.

## Requirements

### Requirement: Guest-Only Checkout

The system MUST support checkout without customer registration or login. Customer accounts, login, and order history are out of scope for the MVP.

#### Scenario: Guest completes checkout without an account

- GIVEN a customer has items in the cart
- WHEN they proceed to checkout
- THEN the system SHALL request only contact data (name, phone, email) and MUST NOT require account creation

### Requirement: Cart Holds Selected Variants

The cart MUST store the specific product variant (size/color) and quantity selected, not just the product.

#### Scenario: Add variant to cart

- GIVEN a customer selects size M, color Negro, quantity 1
- WHEN they add it to the cart
- THEN the cart SHALL show that exact variant with quantity 1

### Requirement: No Shipping/Address Collection

Checkout MUST NOT collect a shipping address, since all orders are pickup-only at Plata 192.

#### Scenario: Checkout form omits address fields

- GIVEN a customer reaches the checkout form
- WHEN the form renders
- THEN it SHALL contain contact fields only and MUST NOT contain address or shipping-method fields

### Requirement: Dual Payment Choice

Checkout MUST let the customer choose between paying online via MercadoPago or reserving with cash/transfer paid at pickup.

#### Scenario: Customer selects MercadoPago

- GIVEN a customer is at the payment step
- WHEN they select "Pagar con MercadoPago"
- THEN the system SHALL redirect to MercadoPago Checkout Pro for that order

#### Scenario: Customer selects pickup reservation

- GIVEN a customer is at the payment step
- WHEN they select "Reservar y pagar al retirar"
- THEN the system SHALL create a reserved order per the pickup-reservation spec, without charging online

### Requirement: Stock Re-Validation at Submission

Cart quantity MUST be re-validated against current available stock at checkout submission, not only at add-to-cart time.

#### Scenario: Stock changed while item was in cart

- GIVEN a variant had 1 unit available when added to cart
- WHEN another order consumes that unit before this customer submits checkout
- THEN the system MUST reject the submission for that line and inform the customer the size is no longer available

### Requirement: Checkout Contact Format Validation

`POST /api/checkout` MUST validate that submitted `email` and `phone` look like a plausible value of their respective type before any database work. The check MUST be permissive — it MUST reject obviously invalid values (empty string, or a value with no digits for phone / no `@` and domain shape for email) but MUST NOT enforce a strict Argentina-specific phone format, since real customers write numbers inconsistently (with/without leading `0`, `15`, area code). This is a new check inside the existing `validateRequestBody()`, not a replacement of it.

#### Scenario: Obviously invalid email rejected

- GIVEN a checkout submission has `email: "x"`
- WHEN it reaches `POST /api/checkout`
- THEN the system MUST respond `400 Bad Request` and MUST NOT create an order or place a stock hold

#### Scenario: Obviously invalid phone rejected

- GIVEN a checkout submission has `phone: "x"` (or empty)
- WHEN it reaches `POST /api/checkout`
- THEN the system MUST respond `400 Bad Request` and MUST NOT create an order or place a stock hold

#### Scenario: A real, inconsistently formatted Argentine phone is accepted

- GIVEN a checkout submission has a phone number missing a leading `0`, written with `15`, or with/without an area code
- WHEN it reaches `POST /api/checkout`
- THEN the system MUST NOT reject it for format, since the check verifies plausibility, not strict national formatting

### Requirement: Checkout Request Rate Limiting

`POST /api/checkout` MUST be rate-limited at the edge (Nginx), mirroring the existing `mp_webhook` `limit_req_zone` pattern, so a burst of automated submissions is rejected before reaching the Node application.

#### Scenario: Request burst exceeds the configured rate

- GIVEN a client sends requests to `POST /api/checkout` faster than the configured rate
- WHEN the excess requests arrive
- THEN Nginx MUST reject them before they reach the application, and no order or stock hold MUST be created for the rejected requests

#### Scenario: Normal checkout traffic is unaffected

- GIVEN a client submits a single checkout request at normal pace
- WHEN it reaches Nginx
- THEN it SHALL pass through to the application unaffected by the rate limit

### Requirement: Per-Identity Concurrent Reservation Cap

The system MUST cap the number of concurrent unconfirmed `PICKUP_CASH` reservations held by the same identity at `N = 3`. An identity is the combination of submitted `email` AND `phone` together — both MUST match an existing open (unexpired, unconfirmed) `PICKUP_CASH` reservation for it to count against the cap. This check MUST run inside the same transaction as `createPendingOrder()`'s existing stock `hold()`, so it composes atomically with the stock guard.

Exceeding the cap MUST reject the checkout submission with explicit copy telling the customer they already have open reservations and how to resolve it, and MUST create no order and place no stock hold.

A customer who mistypes only `email` or only `phone` on a repeat order MUST NOT be blocked by this cap, since both fields must match for the identity to count.

This cap applies only to `PICKUP_CASH` reservations; it MUST NOT affect the MercadoPago payment path. `nextOpenBusinessDayClose()` and the reservation hold window are unaffected by this change.

#### Scenario: Fourth concurrent reservation for the same identity is rejected

- GIVEN an identity (email AND phone) already has 3 open unconfirmed `PICKUP_CASH` reservations
- WHEN the same identity submits a 4th `PICKUP_CASH` checkout
- THEN the system MUST reject it with copy explaining they already have open reservations and how to resolve it
- AND MUST NOT create an order or place a stock hold

#### Scenario: Third concurrent reservation for the same identity is accepted

- GIVEN an identity already has 2 open unconfirmed `PICKUP_CASH` reservations
- WHEN the same identity submits a 3rd `PICKUP_CASH` checkout
- THEN the system SHALL create the order and place the stock hold as normal

#### Scenario: Partial identity match does not count against the cap

- GIVEN an identity has an open `PICKUP_CASH` reservation under `email: "a@x.com", phone: "1122334455"`
- WHEN a checkout is submitted with the same phone but a different email (or vice versa)
- THEN the new submission MUST NOT be counted against the first identity's cap and SHALL proceed normally, subject to its own cap

#### Scenario: Normal single checkout is unaffected

- GIVEN a customer with no other open reservations checks out once, via either MercadoPago or pickup reservation
- WHEN the submission completes
- THEN the order SHALL be created exactly as before this change
- AND `nextOpenBusinessDayClose()` behavior on the resulting hold's expiry (for `PICKUP_CASH`) SHALL remain unchanged

## Open UX Decision (for design phase)

- Account icon in header: MAY route to a simple order-lookup-by-reference flow, or MAY be deferred. Not specified further here.
