# Delta for cart-checkout

**Type**: Delta — modifies the existing `cart-checkout` capability. Adds a dedicated `/carrito` view, quantity editing, line removal, post-order cart clearing, empty-cart and dropped-line handling, per-line stock-conflict reporting, and a shorter cookie lifetime. `Stock Re-Validation at Submission` gains a variantIds-naming scenario but stays the authoritative gate.

## ADDED Requirements

### Requirement: Cart View

`/carrito` MUST render every cart line with product name, size, quantity, unit price, line total, and MUST render an overall subtotal.

#### Scenario: Cart lists all lines with a subtotal

- GIVEN a cart has two lines with different variants and quantities
- WHEN the shopper opens `/carrito`
- THEN each line SHALL show product, size, qty, unit price, and line total
- AND the page SHALL show a subtotal equal to the sum of line totals

### Requirement: Cart Quantity Editing

Each cart line MUST offer a quantity control capped at the variant's current available stock (`onHand - held`) and MUST NOT allow a value below 1; reaching 0 MUST require the explicit removal action instead. If available stock drops below the cart quantity while idle, `/carrito` MUST clamp the editable maximum to current stock and flag the line.

#### Scenario: Quantity increased within available stock

- GIVEN a line's variant has 5 units available and the line has qty 2
- WHEN the shopper raises the quantity to 4
- THEN the system SHALL update the cart cookie and re-render the line total and subtotal

#### Scenario: Quantity capped at available stock

- GIVEN a line's variant has 3 units available
- WHEN the shopper attempts to set the quantity above 3
- THEN the control MUST cap the value at 3 and MUST NOT accept a higher value

#### Scenario: Quantity cannot reach zero via the stepper

- GIVEN a line has qty 1
- WHEN the shopper attempts to decrease it further via the quantity control
- THEN the control MUST stay at 1 and MUST NOT remove the line implicitly

#### Scenario: Idle cart line exceeds stock that has since dropped

- GIVEN a cart line's quantity is 3 but available stock has dropped to 1 while the cart sat idle
- WHEN the shopper opens `/carrito`
- THEN the line MUST be flagged and its editable maximum clamped to 1
- AND server-side submission gating MUST still apply regardless of the displayed clamp

### Requirement: Explicit Line Removal

Each cart line MUST offer an explicit "Eliminar" action that removes the line regardless of its quantity.

#### Scenario: Shopper removes a line

- GIVEN a cart has a line for variant X
- WHEN the shopper clicks "Eliminar" on that line
- THEN the line SHALL be removed from the cart cookie and disappear from `/carrito`
- AND the subtotal SHALL recompute without that line

### Requirement: Empty Cart State

`/carrito` MUST show an empty-cart message with a way to keep shopping when it has no lines. `/checkout` reached with an empty cart MUST redirect to `/carrito`.

#### Scenario: Cart has no lines

- GIVEN the cart cookie has zero lines (missing, malformed, or emptied)
- WHEN the shopper opens `/carrito`
- THEN the page SHALL show "Tu carrito está vacío" and a link to continue shopping, never an error

#### Scenario: Checkout reached with an empty cart

- GIVEN the cart has zero lines
- WHEN the shopper navigates to `/checkout`
- THEN the system MUST redirect to `/carrito` instead of rendering the payment form

### Requirement: Unresolvable Cart Line Notice

A cart line whose variant no longer resolves (deleted/archived product) or whose stock has reached 0 MUST produce an explicit notice naming what was dropped or unavailable, never a silent disappearance or a silently smaller total.

#### Scenario: Deleted product line detected on the cart page

- GIVEN a cart line references a variant whose product was deleted
- WHEN the shopper opens `/carrito`
- THEN the page MUST show a notice naming the dropped item and MUST NOT silently omit it from the total

#### Scenario: Deleted product line detected on the checkout page

- GIVEN a cart line references a variant that no longer resolves
- WHEN the shopper opens `/checkout`
- THEN the system MUST redirect to `/carrito` carrying that notice, rather than silently changing the payment total

#### Scenario: A cart line's stock reaches zero

- GIVEN a cart line's variant now has 0 available stock
- WHEN the shopper opens `/carrito` or `/checkout`
- THEN the line MUST be shown as unavailable with named copy and MUST block submission, not be silently dropped

### Requirement: Cart Cleared After Order Creation

The cart MUST be cleared server-side upon successful order creation, for both the `PICKUP_CASH` (201 JSON) and MercadoPago (303 redirect) paths.

#### Scenario: Successful PICKUP_CASH order clears the cart

- GIVEN a shopper submits checkout with `PICKUP_CASH`
- WHEN the order is created and the API responds `201`
- THEN the cart cookie MUST be cleared as part of that same server response

#### Scenario: Successful MercadoPago order clears the cart

- GIVEN a shopper submits checkout with MercadoPago
- WHEN the order is created and the API responds with a `303` redirect
- THEN the cart cookie MUST be cleared before that redirect is issued, since no client code runs after it

### Requirement: Cart Cookie Lifetime

The `dominique_cart` cookie's `maxAge` MUST be 7 days.

#### Scenario: Cookie set with 7-day lifetime

- GIVEN a cart-mutating action sets the `dominique_cart` cookie
- WHEN the response headers are inspected
- THEN the cookie's `maxAge` SHALL be 7 days, not 30

### Requirement: Non-Regression — Unaffected Checkout Behaviors

MercadoPago `back_urls` resolution, the per-identity `PICKUP_CASH` reservation cap (`N = 3`), and the existing stock-hold logic in `order.service.ts` MUST remain unchanged by this delta.

#### Scenario: MercadoPago back_urls unaffected

- GIVEN a MercadoPago payment reaches success, pending, or failure
- WHEN MercadoPago redirects the shopper
- THEN all three outcomes SHALL resolve to `/pedido/[code]` exactly as before this change

#### Scenario: Reservation cap unaffected

- GIVEN an identity already has 3 open unconfirmed `PICKUP_CASH` reservations
- WHEN that identity submits a 4th `PICKUP_CASH` checkout
- THEN the submission MUST still be rejected per the existing cap, unmodified by this delta

## MODIFIED Requirements

### Requirement: Stock Re-Validation at Submission

Cart quantity MUST be re-validated against current available stock at checkout submission, not only at add-to-cart time. This server-side gate remains authoritative; the `/carrito` client-side quantity cap is a UI courtesy layer only and MUST NOT weaken, replace, or short-circuit it. A `409` stock-conflict response MUST name the specific affected line(s) using `StockUnavailableError.variantIds`, mapped to their line labels, rather than generic copy.
(Previously: re-validation existed but its 409 response was not required to name the affected lines, and there was no explicit non-weakening constraint against a client-side cap.)

#### Scenario: Stock changed while item was in cart

- GIVEN a variant had 1 unit available when added to cart
- WHEN another order consumes that unit before this customer submits checkout
- THEN the system MUST reject the submission for that line and inform the customer the size is no longer available

#### Scenario: 409 response names the affected line

- GIVEN checkout submission fails server-side re-validation for one variant
- WHEN `POST /api/checkout` responds `409` with `variantIds`
- THEN the client MUST map those ids to their line labels and show copy naming the affected item(s), pointing back to `/carrito`

#### Scenario: Client cap cannot bypass server re-validation

- GIVEN the `/carrito` UI cap allowed a quantity based on stock read at render time
- WHEN that stock has since changed and the shopper submits checkout
- THEN `POST /api/checkout` MUST still re-validate and reject on conflict regardless of what the client UI permitted
