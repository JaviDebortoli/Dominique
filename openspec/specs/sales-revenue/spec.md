# Sales Revenue Specification

## Purpose

Records gross revenue from in-person sales with an explicit payment method, allows voiding a mistaken sale with an exact stock restock, and aggregates gross revenue — split by payment method — across in-person `Sale` rows and online/pickup `Order` rows, filterable by a single day or a date range. Gross revenue only; no cost/profit ("ganancia") data exists to report.

## Requirements

### Requirement: In-Person Sale Recording

Each in-person sale of a variant MUST create exactly one `Sale` row, matching the existing `sellInStore()` one-variant-at-a-time granularity. Each `Sale` MUST record exactly one `PaymentMethod` (`CASH` or `TRANSFER`); a `Sale` MUST NOT be split across more than one payment method. `unitPrice` MUST be resolved the same way as order creation (`variant.priceOverride ?? variant.product.price`) and MUST be persisted transactionally with the existing `StockMovement(IN_STORE_SALE)` write, so a sale and its stock decrement always succeed or fail together.

#### Scenario: In-person sale recorded with a payment method

- GIVEN a variant has available stock
- WHEN staff sell 1 unit and select "Efectivo" as the payment method
- THEN a `Sale` row MUST be created with `paymentMethod: CASH` and `unitPrice` resolved from the variant/product price
- AND the existing `StockMovement(IN_STORE_SALE)` write MUST still occur in the same transaction

#### Scenario: Sale rejected without a payment method

- GIVEN staff attempt to record an in-person sale
- WHEN no payment method (`CASH` or `TRANSFER`) is supplied
- THEN the system MUST reject the request and MUST NOT create a `Sale` or `StockMovement` row

#### Scenario: Split payment is rejected

- GIVEN staff attempt to record one in-person sale
- WHEN the request names more than one payment method for that sale
- THEN the system MUST reject the request as invalid and MUST NOT create any `Sale` row

### Requirement: Sale Voiding (Anular)

A `Sale` MUST be voidable by staff. Voiding MUST restore the exact stock quantity the sale removed, using the same concurrency-safe conditional-update discipline the codebase already applies to other stock mutations — never a blind additive `+qty` restock. A voided `Sale` MUST be excluded from all revenue totals from the moment it is voided onward. Voiding a `Sale` that is already voided MUST be a no-op/rejected and MUST NOT restock a second time.

#### Scenario: Voiding restores exact stock and excludes the sale from revenue

- GIVEN a `Sale` of 2 units was recorded, decrementing `onHand` by 2
- WHEN staff void that `Sale`
- THEN `onHand` MUST increase by exactly 2 (not more, not less)
- AND that `Sale` MUST be excluded from the revenue report from that point forward

#### Scenario: Voiding an already-voided sale is rejected

- GIVEN a `Sale` has already been voided
- WHEN staff attempt to void it again
- THEN the system MUST reject the request (or no-op) and MUST NOT restock stock a second time
- AND the sale's excluded-from-revenue state MUST remain unchanged

### Requirement: Revenue Aggregation by Period and Payment Method

The revenue report MUST aggregate gross revenue from non-voided `Sale` rows UNION `Order` rows where `status IN (PAID, PICKED_UP)`, grouped by payment method: efectivo (`Sale.paymentMethod = CASH`), transferencia (`Sale.paymentMethod = TRANSFER` and `Order.paymentMethod = TRANSFER` for `PICKUP_CASH` pickups), and pago online (MercadoPago `Order`s). The report MUST NOT include cost/profit data. The report MUST be filterable by a single day or by a date range (inclusive start/end). Each qualifying `Sale` or `Order` MUST be counted exactly once regardless of filter shape. The report MUST NOT fabricate data for dates before this change's ship date, since pre-change `IN_STORE_SALE` `StockMovement` rows carry no price; it MUST instead show an explicit, honest empty/limited state for such dates rather than a silently-zero or misleading total.

#### Scenario: Single-day filter

- GIVEN sales and paid/picked-up orders exist on 2026-09-10
- WHEN staff filter the report to that single day
- THEN totals MUST reflect only that day's qualifying `Sale` and `Order` rows, split by efectivo/transferencia/pago online

#### Scenario: Date-range filter

- GIVEN sales and orders span 2026-09-01 through 2026-09-30
- WHEN staff filter the report to that date range
- THEN totals MUST sum every qualifying `Sale` and `Order` row whose date falls within the inclusive range, split by payment method

#### Scenario: No double-counting across Sale and Order

- GIVEN a `PICKUP_CASH` order was marked picked up with `paymentMethod: TRANSFER`
- WHEN the report aggregates transferencia revenue for that period
- THEN that order's amount MUST be counted exactly once, as an `Order`-sourced amount, and MUST NOT also appear as a `Sale`

#### Scenario: Voided sale excluded from totals

- GIVEN a `Sale` was voided
- WHEN the report aggregates revenue for the period covering that sale's original date
- THEN the voided `Sale`'s amount MUST NOT be included in any total

#### Scenario: Honest empty state for pre-ship-date ranges

- GIVEN a requested day or range falls entirely before this change shipped
- WHEN staff run the report for that period
- THEN the report MUST show an explicit message stating no in-person sale data exists before that date, rather than presenting a zero or partial total as if it were complete
