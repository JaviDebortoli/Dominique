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

### Requirement: Header Category Navigation

The storefront header MUST present category navigation as a single collapsed control, not a persistently expanded row. The control MUST be closed by default on every page load. When opened it MUST reveal one link per category, each navigating to `/categoria/{slug}`, using the same category set and labels as the rest of the storefront. It MUST close on `Escape`, on a pointer interaction outside the control, and when one of its category links is selected. When there are no categories, no category-navigation control MUST render. This requirement governs the header only; home-page category tiles and other category entry points are out of its scope and MUST remain unaffected.

#### Scenario: Category navigation is collapsed by default

- GIVEN a customer opens any storefront page
- WHEN the header renders
- THEN the category links MUST NOT be visible or in the accessibility tree
- AND a single labeled control (e.g. "Categorías") MUST be present, marked as collapsed

#### Scenario: Opening the control reveals the category links

- GIVEN the header shows the collapsed category control
- AND categories "Vestidos" and "Accesorios" exist
- WHEN the customer activates the control
- THEN a link to `/categoria/vestidos` and a link to `/categoria/accesorios` MUST become available
- AND the control MUST be marked as expanded

#### Scenario: Selecting a category closes the control and navigates

- GIVEN the category control is open
- WHEN the customer clicks the "Vestidos" link
- THEN the system MUST navigate to `/categoria/vestidos`
- AND the control MUST return to its collapsed state

#### Scenario: Escape and outside click dismiss the control

- GIVEN the category control is open
- WHEN the customer presses `Escape` OR clicks outside the control
- THEN the control MUST return to its collapsed state
- AND no navigation MUST occur

#### Scenario: No categories means no control

- GIVEN there are zero categories
- WHEN the header renders
- THEN no category-navigation control MUST appear in the header

#### Scenario: Home-page category entry points are unaffected

- GIVEN the home page renders its own category tiles/sections
- WHEN this change ships
- THEN those tiles MUST still be present and link to their category pages, independent of the header control
