# Pickup Reservation Specification

## Purpose

Defines the cash/transfer-at-pickup reservation flow: how stock is held, for how long, and how unfulfilled reservations are released.

## Requirements

### Requirement: Reservation Holds Stock as Reserved-Unpaid

Choosing cash/transfer-at-pickup MUST create a reservation that decrements available stock, tagging it as "reserved, unpaid" — distinct from stock sold via confirmed MercadoPago payment.

#### Scenario: Reservation reduces available stock

- GIVEN a variant has 3 units available
- WHEN a customer reserves 1 unit via cash/transfer at pickup
- THEN available stock SHALL become 2, and 1 unit SHALL be tagged reserved-unpaid, not sold-paid

### Requirement: Bounded Hold Window

A reservation MUST be held only until the next business day the physical store is open.

#### Scenario: Reservation placed the evening before a business day

- GIVEN the store is open the next calendar day
- WHEN a customer reserves an order today after hours
- THEN the hold SHALL expire at the end of that next business day if unpaid and unpicked-up

### Requirement: Auto-Release on Expiry

If a reservation is not paid and picked up within the hold window, the system MUST automatically release its stock back to available.

#### Scenario: Unpaid reservation expires

- GIVEN a reservation's hold window has elapsed
- WHEN no payment or pickup was recorded
- THEN the system SHALL release the reserved-unpaid stock back to available and mark the order `expired`

#### Scenario: Reservation fulfilled within window

- GIVEN a customer pays and picks up within the hold window
- WHEN staff marks the order picked up
- THEN the reserved-unpaid stock SHALL transition to sold-paid (or equivalent fulfilled state) and MUST NOT be auto-released

### Requirement: Reservation Never Confused With Confirmed Payment

The auto-release rule MUST apply only to reserved-unpaid stock. Stock decremented from a confirmed MercadoPago payment MUST NEVER be auto-released.

#### Scenario: Auto-release job runs

- GIVEN the scheduled release process runs
- WHEN it scans expired holds
- THEN it MUST only affect reserved-unpaid orders and MUST NOT touch sold-paid orders
