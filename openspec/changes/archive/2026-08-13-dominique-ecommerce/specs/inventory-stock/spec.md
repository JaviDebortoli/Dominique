# Inventory & Stock Specification

## Purpose

Defines the single shared stock source of truth between the online store and the physical store, and the hard rule that online-paid stock can never resurface as sellable in-store.

## Requirements

### Requirement: Single Shared Stock Source

Stock MUST be shared between the online storefront and the physical store — there SHALL be one authoritative stock quantity per variant, not separate online/in-store pools.

#### Scenario: In-store sale reduces online-visible stock

- GIVEN a variant has 2 units available
- WHEN staff records an in-store sale of 1 unit via admin reconciliation
- THEN the online storefront SHALL immediately show 1 unit available

### Requirement: Distinct Stock States

Each variant's stock MUST be trackable across three distinct states: available, reserved-unpaid, and sold-paid.

#### Scenario: State breakdown visible

- GIVEN a variant started with 5 available units
- WHEN 1 unit is reserved (cash/transfer, unpaid) and 1 unit is sold via confirmed MercadoPago payment
- THEN the system SHALL report 3 available, 1 reserved-unpaid, 1 sold-paid

### Requirement: Confirmed Online Payment Decrements Stock Atomically and Immediately (HARD RULE)

Stock affected by a confirmed MercadoPago payment MUST be decremented atomically and immediately at the moment of server-side webhook confirmation — never at cart addition, checkout submission, or any later deferred step — so a paid variant is never sellable in the physical store afterward.

#### Scenario: Real-time accuracy for in-store staff

- GIVEN a customer's MercadoPago payment is confirmed via webhook
- WHEN in-store staff check current stock for that variant seconds later
- THEN the reduced quantity MUST already be reflected, with no window in which the sold-paid unit still appears available

### Requirement: Reservations Decrement Available Stock Without Marking Sold

A cash/transfer-at-pickup reservation MUST decrement available stock (to prevent overselling the reservation) while tagging it reserved-unpaid, never sold-paid.

#### Scenario: Reservation prevents overselling

- GIVEN a variant has 1 unit available
- WHEN one customer reserves it via cash/transfer
- THEN available stock SHALL become 0 and a second customer MUST NOT be able to reserve or buy that unit

### Requirement: Auto-Release Applies Only to Reserved-Unpaid Stock

Only reserved-unpaid stock MUST be eligible for auto-release per the pickup-reservation hold window. Sold-paid stock MUST NEVER auto-release or return to available.

#### Scenario: Expired reservation vs. confirmed payment

- GIVEN one unit is reserved-unpaid and past its hold window, and another unit is sold-paid
- WHEN the auto-release process runs
- THEN only the reserved-unpaid unit SHALL return to available; the sold-paid unit MUST remain excluded from sale permanently

### Requirement: Manual Admin Reconciliation

Staff MUST be able to manually adjust stock (e.g. for damage, in-store sale, correction) with the adjustment reflected immediately in the shared stock source.

#### Scenario: Staff corrects a stock count

- GIVEN staff finds a discrepancy during a physical count
- WHEN they adjust the variant's available stock in admin
- THEN the corrected value SHALL apply immediately across storefront and admin views
