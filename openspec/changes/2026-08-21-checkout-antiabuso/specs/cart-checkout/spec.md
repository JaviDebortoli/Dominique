# Delta for cart-checkout

**Type**: Delta — modifies the existing `cart-checkout` capability. Adds checkout input-format validation and abuse-resistance limits; no requirement covers either today.

## ADDED Requirements

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
