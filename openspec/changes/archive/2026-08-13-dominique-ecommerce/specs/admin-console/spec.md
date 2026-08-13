# Admin Console Specification

## Purpose

Defines the authenticated staff panel for catalog management, order status updates, and the real-time stock check staff need before any in-person sale.

## Requirements

### Requirement: Authenticated Access

The admin console MUST require authentication; unauthenticated requests MUST be blocked from all admin routes.

#### Scenario: Unauthenticated access blocked

- GIVEN a user is not logged in
- WHEN they request an admin route
- THEN the system MUST redirect them to login and MUST NOT expose admin data or actions

### Requirement: Product and Variant Management

Staff MUST be able to create, edit, and deactivate products, categories, variants, and stock quantities, including image upload, without engineering assistance.

#### Scenario: Owner adds a product unaided

- GIVEN the owner is logged into admin
- WHEN they create a new product with size/color variants, stock counts, and images
- THEN the product SHALL be saved and immediately available for storefront listing (once activated)

### Requirement: Order Status Management

Staff MUST be able to view orders and transition their status per the order-lifecycle spec.

#### Scenario: Staff updates order status

- GIVEN an order is `paid`
- WHEN staff marks it `ready for pickup`
- THEN the order's status SHALL update and be visible to the customer via order lookup

### Requirement: Real-Time-Accurate Stock View Before In-Person Sale (HARD RULE)

The admin console MUST provide staff a stock view reflecting real-time availability — including immediate decrements from confirmed MercadoPago payments — and staff MUST consult it before completing any physical/in-person sale.

#### Scenario: Staff checks stock before an in-store sale

- GIVEN a variant was just sold online and paid via MercadoPago moments ago
- WHEN staff open the admin stock view before ringing up an in-person sale of that same variant
- THEN the view SHALL already show the reduced (or zero) available quantity, preventing a double-sell

#### Scenario: Reserved-unpaid stock shown distinctly

- GIVEN a variant has both reserved-unpaid and sold-paid units
- WHEN staff view its stock breakdown
- THEN the view SHALL distinguish available, reserved-unpaid, and sold-paid quantities
