# Product Catalog Specification

## Purpose

Defines the data model and rules for categories, products, size/color variants, per-variant stock, and product images that back the storefront and admin panel.

## Requirements

### Requirement: Product Structure

The system MUST model each product with a category, a set of size/color variants, and one or more images.

#### Scenario: Product created with variants

- GIVEN an admin creates a product
- WHEN they define at least one size/color variant with a stock quantity
- THEN the product SHALL be saved with its variants linked to it

#### Scenario: Product without images

- GIVEN an admin saves a product with no image uploaded
- WHEN the product is persisted
- THEN the system SHALL still allow the save but SHOULD flag the product as incomplete for storefront display

### Requirement: Variant Uniqueness

Each product variant MUST be uniquely identified by the combination of product, size, and color.

#### Scenario: Duplicate variant rejected

- GIVEN a product already has a variant with size "M" and color "Negro"
- WHEN an admin attempts to add another variant with the same size and color
- THEN the system MUST reject the duplicate and SHALL prompt to edit the existing variant instead

### Requirement: Category Association

Every product MUST belong to exactly one category at a time.

#### Scenario: Product listed under its category

- GIVEN a product is assigned to category "Vestidos"
- WHEN a customer browses the "Vestidos" category
- THEN the product SHALL appear in that category's listing

### Requirement: Per-Variant Stock Field

Each variant MUST carry its own stock quantity, independent of other variants of the same product.

#### Scenario: One size sold out, others available

- GIVEN a product has variants for sizes S, M, and L
- WHEN size M reaches zero stock
- THEN sizes S and L SHALL remain purchasable while size M is marked unavailable
