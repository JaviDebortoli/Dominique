# Delta for admin-console

**Type**: Delta — modifies `admin-console`. Adds product/variant edit and delete to requirements in `openspec/specs/admin-console/spec.md`.

## MODIFIED Requirements

### Requirement: Authenticated Access

The admin console MUST require authentication; unauthenticated requests MUST be blocked from all admin routes, including standalone `/api/admin/*` route handlers that sit outside the console route-group's middleware matcher and therefore MUST verify the session independently.

(Previously: covered `POST /api/admin/categories` and `PATCH`/`DELETE` on `/api/admin/categories/[id]`; now also covers `PATCH`/`DELETE` on `/api/admin/products/[id]` and its variants sub-route.)

#### Scenario: Unauthenticated access blocked

- GIVEN a user is not logged in
- WHEN they request an admin route
- THEN the system MUST redirect to login and MUST NOT expose admin data or actions

#### Scenario: Unauthenticated request to an admin API route

- GIVEN a user has no valid session
- WHEN they call `POST /api/admin/categories` directly
- THEN the system MUST respond `401 Unauthorized` as JSON and MUST NOT create a category

#### Scenario: Unauthenticated rename or delete

- GIVEN a user has no valid session
- WHEN they call `PATCH` or `DELETE` on `/api/admin/categories/[id]`
- THEN the system MUST respond `401 Unauthorized` as JSON, not a redirect
- AND MUST NOT rename or delete the category

#### Scenario: Unauthenticated product or variant mutation

- GIVEN a user has no valid session
- WHEN they call `PATCH` or `DELETE` on `/api/admin/products/[id]` or its variants sub-route
- THEN the system MUST respond `401 Unauthorized` as JSON, not a redirect
- AND MUST NOT mutate the product or variant

### Requirement: Product and Variant Management

Staff MUST be able to create, rename, and delete categories; create, edit, and delete products and variants; and create stock, without engineering assistance. Category creation MUST validate `slug` and reject a duplicate. `PATCH /api/admin/categories/[id]` MUST update `name` only; `slug` MUST stay immutable — a payload containing a `slug` key MUST be rejected whole with `400 Bad Request`, never silently stripped. A `name`-only payload MUST return `409 Conflict` on a case-insensitive collision. `DELETE /api/admin/categories/[id]` MUST succeed when the category has zero products, else be blocked with a typed error stating the exact assigned-product count. `PATCH /api/admin/products/[id]` MUST update `name`, `description`, `price`, and `categoryId` only; `slug` follows the same immutable, reject-the-whole-request rule as categories. `DELETE /api/admin/products/[id]` MUST hard-delete the product and its variants/images, and MUST be blocked with a cause-specific typed error when any variant has `OrderItem`/`StockMovement` history, or (a distinct message) when any variant has `onHand > 0`. `PATCH .../variants/[variantId]` MUST update `sku` with a global-uniqueness check (`409 Conflict` on collision); `size` and `color` MUST be rejected with a typed error once the variant has any `OrderItem` row, while `sku` stays editable on that same variant. `DELETE .../variants/[variantId]` MUST succeed only when the variant has no order/stock history, `onHand === 0`, and is not the product's last remaining variant; each of the three blocking causes MUST return a distinct message. `PATCH`/`DELETE` on a non-existent category, product, or variant id MUST return `404 Not Found`. Neither product nor variant edit surfaces MUST expose `onHand` or `held` as editable fields. Deactivation is NOT delivered: `Category` has no `isActive` field.

(Previously: covered category creation/rename/delete and product/variant creation only; this adds product edit, product delete, variant edit, variant delete, and the blocking rules for history, stock, last-variant-standing, and attribute immutability.)

#### Scenario: Owner adds a product unaided

- GIVEN the owner is logged into admin
- WHEN they create a product with variants, stock, and images
- THEN the product SHALL be saved and available for storefront listing (once activated)

#### Scenario: Owner creates a category unaided

- GIVEN the owner is logged into `/admin/categorias`
- WHEN they submit `name: "Bijoutería"` with the auto-suggested slug
- THEN the category SHALL be saved and appear in the category picker and list with a product count of 0

#### Scenario: Duplicate slug rejected

- GIVEN a category with slug `bijouteria` exists
- WHEN the owner submits a new category whose slug also resolves to `bijouteria`
- THEN the system MUST respond `409 Conflict` with a readable message and MUST NOT create any row

#### Scenario: Invalid slug rejected before the database

- GIVEN the owner submits a slug with spaces, uppercase, or accents (e.g. `Ropa Íntima`)
- WHEN the request reaches `POST /api/admin/categories`
- THEN the system MUST reject it with a validation error before reaching Prisma or the database

#### Scenario: Slug auto-suggestion strips accents

- GIVEN the owner types `name: "Bijoutería"` and has not hand-edited the slug
- WHEN the slug auto-suggests
- THEN it SHALL normalize accents to ASCII (NFD, strip marks) into `bijouteria`, matching `/^[a-z0-9]+(-[a-z0-9]+)*$/`
- AND the display `name` SHALL keep its original accents

#### Scenario: Empty category displays as-is on the storefront

- GIVEN a category has zero products
- WHEN a customer browses to that category's storefront page
- THEN it SHALL render via existing null-safe thumbnail handling with no exclusion logic

#### Scenario: Owner renames a category

- GIVEN a category has `name: "Bijuteria"` and `slug: "bijuteria"`
- WHEN the owner submits `PATCH /api/admin/categories/[id]` with `{"name": "Bijutería"}`
- THEN `name` SHALL update to "Bijutería"
- AND `slug` SHALL remain `"bijuteria"`

#### Scenario: Slug key in the payload is rejected, not silently ignored

- GIVEN a category has `name: "Bijuteria"` and `slug: "bijuteria"`
- WHEN the owner submits `PATCH /api/admin/categories/[id]` with `{"name": "Bijutería", "slug": "otra-slug"}`
- THEN the system MUST respond `400 Bad Request` and MUST NOT update `name` or `slug`

#### Scenario: Duplicate name rejected on rename

- GIVEN categories "Vestidos" and "Accesorios" exist
- WHEN the owner renames "Accesorios" to `"vestidos"` (case-insensitive collision)
- THEN the system MUST respond `409 Conflict` and MUST NOT rename the category

#### Scenario: Owner deletes an empty category

- GIVEN a category has zero products
- WHEN the owner calls `DELETE /api/admin/categories/[id]`
- THEN the category SHALL be removed from the list and the product form's picker

#### Scenario: Delete blocked when category has products

- GIVEN a category has 12 products assigned
- WHEN the owner calls `DELETE /api/admin/categories/[id]`
- THEN the system MUST respond with a typed error stating the exact count (e.g. "12 productos asignados")
- AND MUST NOT delete the category or any product

#### Scenario: Rename or delete a non-existent category

- GIVEN no category exists with the given id
- WHEN the owner calls `PATCH` or `DELETE` on `/api/admin/categories/[id]`
- THEN the system MUST respond `404 Not Found` and MUST NOT mutate any category

#### Scenario: Owner edits a product's core fields

- GIVEN a product has `name: "Vestido Lino"`, `price: 45000`, `categoryId` in "Vestidos"
- WHEN the owner submits `PATCH /api/admin/products/[id]` with `{"name": "Vestido Lino Beige", "price": 48000, "categoryId": "<accesorios-id>"}`
- THEN `name`, `price`, and `categoryId` SHALL update
- AND `slug` SHALL remain unchanged

#### Scenario: Product slug key in the payload is rejected, not silently ignored

- GIVEN a product has `slug: "vestido-lino"`
- WHEN the owner submits `PATCH /api/admin/products/[id]` with a payload including a `slug` key
- THEN the system MUST respond `400 Bad Request` and MUST NOT update any field

#### Scenario: Owner deletes a clean product

- GIVEN a product's variants have no `OrderItem`/`StockMovement` rows and every variant has `onHand === 0`
- WHEN the owner calls `DELETE /api/admin/products/[id]`
- THEN the product and its variants/images SHALL be removed

#### Scenario: Product delete blocked by order/stock history

- GIVEN a product has a variant with at least one `OrderItem` or `StockMovement` row
- WHEN the owner calls `DELETE /api/admin/products/[id]`
- THEN the system MUST respond with a typed error naming order/stock history as the cause
- AND MUST NOT delete the product or any variant

#### Scenario: Product delete blocked by remaining stock

- GIVEN a product has no history but at least one variant has `onHand > 0`
- WHEN the owner calls `DELETE /api/admin/products/[id]`
- THEN the system MUST respond with a typed error naming remaining stock, distinct from the history message
- AND MUST NOT delete the product or any variant

#### Scenario: Owner edits a variant's SKU

- GIVEN a variant has `sku: "VL-BEI-M"` and no other variant uses `"VL-BEI-XL"`
- WHEN the owner submits `PATCH .../variants/[variantId]` with `{"sku": "VL-BEI-XL"}`
- THEN `sku` SHALL update

#### Scenario: Duplicate SKU rejected on variant edit

- GIVEN a variant elsewhere already has `sku: "VL-BEI-XL"`
- WHEN the owner submits `PATCH .../variants/[variantId]` with `{"sku": "VL-BEI-XL"}`
- THEN the system MUST respond `409 Conflict` and MUST NOT update the variant

#### Scenario: Variant size/color immutable after first sale

- GIVEN a variant has at least one `OrderItem` row
- WHEN the owner submits `PATCH .../variants/[variantId]` with a `size` or `color` change
- THEN the system MUST respond with a typed error and MUST NOT update `size` or `color`
- AND an `sku`-only change on the same variant SHALL still succeed

#### Scenario: Owner deletes a clean variant

- GIVEN a variant has no order/stock history, `onHand === 0`, and its product has another variant
- WHEN the owner calls `DELETE .../variants/[variantId]`
- THEN the variant SHALL be removed and the product SHALL remain

#### Scenario: Variant delete blocked by order/stock history

- GIVEN a variant has at least one `OrderItem` or `StockMovement` row
- WHEN the owner calls `DELETE .../variants/[variantId]`
- THEN the system MUST respond with a typed error naming order/stock history as the cause
- AND MUST NOT delete the variant

#### Scenario: Variant delete blocked by remaining stock

- GIVEN a variant has no history but `onHand > 0`
- WHEN the owner calls `DELETE .../variants/[variantId]`
- THEN the system MUST respond with a typed error naming remaining stock as the cause
- AND MUST NOT delete the variant

#### Scenario: Variant delete blocked as the product's last remaining variant

- GIVEN a variant has no history, `onHand === 0`, and is the product's only variant
- WHEN the owner calls `DELETE .../variants/[variantId]`
- THEN the system MUST respond with a typed error naming last-variant-standing as the cause
- AND MUST NOT delete the variant
- AND the message SHALL direct the owner to delete the product instead

#### Scenario: PATCH/DELETE a non-existent product or variant

- GIVEN no product or variant exists with the given id
- WHEN the owner calls `PATCH` or `DELETE` on `/api/admin/products/[id]` or its variants sub-route
- THEN the system MUST respond `404 Not Found` and MUST NOT mutate any row
