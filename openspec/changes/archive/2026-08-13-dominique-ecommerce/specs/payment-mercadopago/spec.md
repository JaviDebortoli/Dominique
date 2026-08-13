# MercadoPago Payment Specification

## Purpose

Defines server-verified online payment via MercadoPago Checkout Pro, including the hard requirement that confirmed payment immediately and atomically removes stock from sale everywhere.

## Requirements

### Requirement: Server-Side Payment Verification

The system MUST verify payment status server-side via the MercadoPago Get Payment API and MUST NOT trust client-side redirect parameters as proof of payment.

#### Scenario: Client redirected to success page before webhook arrives

- GIVEN a customer completes payment and is redirected to the success URL
- WHEN the webhook confirmation has not yet been received
- THEN the order MUST remain in `pending` status until server-side confirmation completes

### Requirement: Idempotent Webhook Processing

The payment webhook handler MUST be idempotent per MercadoPago payment id.

#### Scenario: Webhook delivered twice for the same payment

- GIVEN a webhook notification for payment id X was already processed and stock decremented
- WHEN MercadoPago redelivers the same notification for payment id X
- THEN the system MUST NOT decrement stock a second time or duplicate the paid-order state change

### Requirement: Atomic, Immediate Stock Decrement on Confirmed Payment (HARD RULE)

When the webhook confirms a payment as approved via the Get Payment API, the system MUST decrement the affected variant's stock atomically and immediately, in the same server-side transaction as the payment confirmation — never deferred to cart submission or checkout time. This ensures a variant paid for online is never sellable in the physical store afterward.

#### Scenario: Payment confirmed decrements stock immediately

- GIVEN an order's MercadoPago payment is approved
- WHEN the webhook handler confirms the payment via Get Payment API
- THEN the system SHALL, within that same transaction, mark the order `paid` and decrement the variant stock as sold-paid
- AND in-store staff checking stock immediately afterward SHALL see the reduced quantity

#### Scenario: Payment rejected or cancelled

- GIVEN an order's MercadoPago payment is rejected or cancelled
- WHEN the webhook handler confirms this status
- THEN the system MUST NOT decrement stock and SHALL mark the order accordingly (e.g. `cancelled`)

### Requirement: Pending Payment States Modeled Explicitly

The system MUST represent MercadoPago's `pending`/`in_process` payment states without decrementing stock as sold.

#### Scenario: Payment left pending

- GIVEN a payment status returned is `pending`
- WHEN the webhook processes it
- THEN the order SHALL remain `pending` and stock MUST NOT be marked sold-paid until an `approved` confirmation arrives
