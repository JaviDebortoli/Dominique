# Storefront Browsing Specification

## Purpose

Defines the customer-facing browsing experience: home, category listings, and product detail page (PDP), all reflecting real-time stock and matching the `ejemplo/DESIGN.md` tokens.

## Requirements

### Requirement: Home Page Layout

The storefront home page MUST render per the approved mockup, using curated categories and products.

#### Scenario: Home loads with categories and curated products

- GIVEN a customer visits the home page
- WHEN the page loads
- THEN the system SHALL display navigation, curated product sections, and category entry points matching the mockup

### Requirement: Category Listing

The system MUST provide a listing page per category showing all active products assigned to it.

#### Scenario: Customer browses a category

- GIVEN category "Accesorios" has active products
- WHEN a customer opens the category page
- THEN the system SHALL list those products with price and thumbnail image

### Requirement: Product Detail Page Variant Selector

The PDP MUST show a size/color selector reflecting real-time per-variant stock.

#### Scenario: Selecting an available size

- GIVEN a product has size M in stock
- WHEN a customer selects size M
- THEN the system SHALL enable "add to cart" for that variant

#### Scenario: Selecting an out-of-stock size

- GIVEN a product's size S variant has zero stock
- WHEN a customer views the size selector
- THEN size S MUST be visually disabled and MUST NOT be selectable for purchase

### Requirement: Locale and Copy

All customer-facing text MUST be in Spanish (es-AR).

#### Scenario: Sold-out label

- GIVEN a variant has zero available stock
- WHEN it is rendered on the PDP
- THEN the label SHALL read "Sin stock" (or equivalent es-AR copy), not an English placeholder

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
