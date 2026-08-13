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

## Open UX Decision (for design phase)

- Account icon in header: MAY route to a simple order-lookup-by-reference flow, or MAY be deferred. Not specified further here.
