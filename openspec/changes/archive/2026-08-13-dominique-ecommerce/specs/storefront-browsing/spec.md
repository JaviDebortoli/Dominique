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
