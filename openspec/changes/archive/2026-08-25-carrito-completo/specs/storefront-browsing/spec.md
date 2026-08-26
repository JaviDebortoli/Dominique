# Delta for storefront-browsing

**Type**: Delta — modifies the existing `storefront-browsing` capability. Adds a persistent cart entry point with an item-count badge in the header; no requirement covers this today.

## ADDED Requirements

### Requirement: Header Cart Entry Point

The storefront header MUST show a persistent cart icon linking to `/carrito`, with an item-count badge reflecting the current cart contents. The badge count MUST be server-derived from the cart cookie, not client-guessed state, and MUST reflect the cart after any cart-mutating action (add, edit quantity, remove).

#### Scenario: Badge reflects cart contents on page load

- GIVEN the cart cookie holds 3 total units across its lines
- WHEN any storefront page renders the header
- THEN the cart icon's badge SHALL show 3

#### Scenario: Badge updates after adding an item

- GIVEN the cart is empty
- WHEN the shopper adds an item from the product detail page
- THEN the header badge SHALL reflect the new count on next render, derived from the updated cookie

#### Scenario: Badge updates after a quantity edit or removal

- GIVEN the cart has a line with qty 2
- WHEN the shopper edits its quantity or removes it via `/carrito`
- THEN the header badge SHALL reflect the new total after the mutating Server Action completes

#### Scenario: Badge is correct without client-side JavaScript

- GIVEN JavaScript is disabled or has not yet hydrated
- WHEN the header renders
- THEN the badge SHALL show the count read from the server-side cart cookie, not a client-computed or stale value

#### Scenario: Cart icon links to the cart page

- GIVEN a shopper is on any storefront page
- WHEN they click the header cart icon
- THEN the system SHALL navigate them to `/carrito`
