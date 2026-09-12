# Admin Console Specification

## Purpose

Defines the authenticated staff panel for catalog management, order status updates, and the real-time stock check staff need before any in-person sale.

## Requirements

### Requirement: Authenticated Access

The admin console MUST require authentication; unauthenticated requests MUST be blocked from all admin routes, including standalone `/api/admin/*` route handlers that sit outside the console route-group's middleware matcher and therefore MUST verify the session independently.

`POST /admin/login` MUST be rate-limited at the edge (Nginx), mirroring the `mp_webhook`/`checkout` `limit_req_zone` pattern, to throttle repeated login attempts. This throttle MUST be edge-only and self-resetting; the system MUST NOT implement any persistent account lockout state. The owner MUST always be able to attempt login again with her correct credentials once the edge rate-limit window resets, regardless of how many prior attempts failed.

(Previously: covered unauthenticated blocking only, across page routes and the API route handlers named above. This adds an edge rate limit on repeated `/admin/login` POSTs, explicitly with no persistent lockout.)

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

#### Scenario: Repeated login attempts throttled at the edge

- GIVEN a client sends `POST /admin/login` requests faster than the configured rate
- WHEN the excess requests arrive
- THEN Nginx MUST reject them before they reach the application

#### Scenario: Owner is never permanently locked out

- GIVEN the owner (or an attacker) has made many failed `POST /admin/login` attempts
- WHEN the edge rate-limit window resets
- THEN the owner MUST be able to attempt login again with her correct credentials, since no persistent lockout state exists for her account

### Requirement: Product and Variant Management

Staff MUST be able to create, rename, and delete categories; create, edit, delete, and extend products and variants — including adding a new variant or image after creation — and create stock, without engineering assistance. Category creation MUST validate `slug` and reject a duplicate. `PATCH /api/admin/categories/[id]` MUST update `name` only; `slug` MUST stay immutable — a payload containing a `slug` key MUST be rejected whole with `400 Bad Request`, never silently stripped. A `name`-only payload MUST return `409 Conflict` on a case-insensitive collision. `DELETE /api/admin/categories/[id]` MUST succeed when the category has zero products, else be blocked with a typed error stating the exact assigned-product count. `PATCH /api/admin/products/[id]` MUST update `name`, `description`, `price`, and `categoryId` only; `slug` follows the same immutable, reject-the-whole-request rule as categories. `DELETE /api/admin/products/[id]` MUST hard-delete the product and its variants/images, and MUST be blocked with a cause-specific typed error when any variant has `OrderItem`/`StockMovement` history, or (a distinct message) when any variant has `onHand > 0`. `PATCH .../variants/[variantId]` MUST update `sku` with a global-uniqueness check (`409 Conflict` on collision); `size` and `color` MUST be rejected with a typed error once the variant has any `OrderItem` row, while `sku` stays editable on that same variant. `DELETE .../variants/[variantId]` MUST succeed only when the variant has no order/stock history, `onHand === 0`, and is not the product's last remaining variant; each of the three blocking causes MUST return a distinct message. `POST /api/admin/products/[id]/variants` MUST add a new variant to an existing product by wrapping the existing `addVariant()`, reusing its existing duplicate size+color check (`409 Conflict`, no new guard); a new variant MUST always start at `onHand: 0` and the add-variant form MUST expose no stock input — `/admin/caja` stays the sole stock entry point. `POST /api/admin/products/[id]/images` MUST attach an already-uploaded image (`url` required, `altText`/`position` optional) to an existing product, and MUST reject a request that would exceed 5 images per product with a typed `TooManyImagesError`, before any additional write. `DELETE /api/admin/products/[id]/images/[imageId]` MUST remove the image; deleting a product's last remaining image MUST be freely allowed — zero images is already a valid product state. `PATCH /api/admin/products/[id]/images` MUST reorder a product's images: the body is `{ order: string[] }` naming every current image id in the new display order (index 0 becomes the storefront cover), each image's `position` is rewritten to its index in one transaction, and a payload that does not name the product's images exactly (missing, extra, or duplicate id) MUST be rejected whole with `409 Conflict` and write nothing. `PATCH`/`DELETE` on a non-existent category, product, or variant id MUST return `404 Not Found`. Neither product nor variant edit surfaces, nor the add-variant form, MUST expose `onHand` or `held` as editable fields; `onHand`/`held` on an existing variant stay owned solely by `/admin/caja` and `stock.service.ts`. Deactivation is NOT delivered: `Category` has no `isActive` field.

(Previously: covered category creation/rename/delete and product/variant creation/edit/delete only; this adds add-variant via the existing `addVariant()` duplicate size+color check, add-image with a 5-image cap enforced by a new `TooManyImagesError`, and delete-image including the freely-allowed last-image case.)

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

#### Scenario: Owner adds a variant to an existing product

- GIVEN a product exists with one variant `size: "M", color: "Beige"`
- WHEN the owner submits `POST /api/admin/products/[id]/variants` with `{"size": "L", "color": "Beige", "sku": "VL-BEI-L"}` and no stock field
- THEN a new variant SHALL be created with `onHand: 0`
- AND the product SHALL now list both variants

#### Scenario: Adding a duplicate size+color variant is rejected

- GIVEN a product already has a variant with `size: "M", color: "Beige"`
- WHEN the owner submits `POST /api/admin/products/[id]/variants` with the same `size` and `color`
- THEN the system MUST respond with `addVariant()`'s existing typed duplicate error and MUST NOT create a new variant

#### Scenario: Owner adds an image to an existing product

- GIVEN a product exists and the owner has an image file
- WHEN the owner uploads the file via `POST /api/admin/upload` and then submits the returned `url` to `POST /api/admin/products/[id]/images`
- THEN the image SHALL be attached to the product
- AND it SHALL appear in the storefront gallery

#### Scenario: Owner deletes an image, including the last remaining one

- GIVEN a product has exactly one image
- WHEN the owner calls `DELETE /api/admin/products/[id]/images/[imageId]` for that image
- THEN the image SHALL be removed
- AND the product SHALL remain valid with zero images

#### Scenario: Adding a 6th image is rejected

- GIVEN a product already has 5 images
- WHEN the owner submits `POST /api/admin/products/[id]/images` with a 6th image `url`
- THEN the system MUST respond with a typed `TooManyImagesError` and MUST NOT attach the image

#### Scenario: Owner reorders a product's images

- GIVEN a product has three images in positions 0, 1, 2
- WHEN the owner sends `PATCH /api/admin/products/[id]/images` with `order` listing them as `[2, 0, 1]`
- THEN each image's `position` MUST be rewritten to its index in that array
- AND the storefront cover MUST become the image that is now at position 0
- WHEN the `order` array omits an image id, repeats one, or names an unknown id
- THEN the system MUST respond `409 Conflict` and MUST NOT change any position

#### Scenario: Unauthenticated mutation on the new variant/image routes

- GIVEN a user has no valid session
- WHEN they call `POST` on `/api/admin/products/[id]/variants` or `/api/admin/products/[id]/images`, or `DELETE` on `/api/admin/products/[id]/images/[imageId]`
- THEN the system MUST respond `401 Unauthorized` as JSON, not a redirect
- AND MUST NOT create or delete any variant or image

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

### Requirement: Product Table Exclusive Edit Mode

On the `/admin/productos` table, at most one product row's inline edit form MUST be open at any time. Opening the edit form on another row MUST close whichever row was already open, discarding that row's unsaved field changes without issuing a save. Closing an edit form — via its cancel action, `Escape`, or a successful save — MUST return that row to view mode and MUST leave every row free to be edited next. This requirement constrains only the product-field edit form. The variant sub-rows stay a separate expand-only disclosure and MAY remain open regardless of edit state. The product's image manager, however, MUST also be available whenever the edit form is open — editing a product includes editing its images — so it renders when the row is expanded OR being edited.

#### Scenario: Only one edit form open at a time

- GIVEN the owner has opened the edit form on product A
- WHEN the owner clicks "Editar" on product B
- THEN product B's edit form MUST open
- AND product A MUST return to view mode with its unsaved changes discarded
- AND no save MUST be issued for product A

#### Scenario: Cancelling frees the table

- GIVEN the owner is editing product A
- WHEN the owner cancels the edit or presses `Escape`
- THEN product A MUST return to view mode
- AND any product row MUST be editable again

#### Scenario: Saving closes the row

- GIVEN the owner is editing product A
- WHEN the save succeeds
- THEN product A MUST return to view mode showing the refreshed values
- AND any product row MUST be editable again

#### Scenario: Expanded variant/image rows survive edit-mode changes

- GIVEN product A's variant/image sub-rows are expanded
- WHEN the owner opens or closes any product's edit form
- THEN product A's variant/image sub-rows MUST remain visible
- AND MUST stay editable per "Product and Variant Management"

#### Scenario: Editing a product surfaces its image manager

- GIVEN a product row that is NOT expanded
- WHEN the owner opens its edit form
- THEN the product's image manager (add / delete, per-image preview, 5-image cap) MUST be available alongside the field form
- AND closing the edit form MUST hide the image manager again unless the row was also expanded

### Requirement: Admin Console Layout on Narrow Viewports

Each admin data table — `/admin/productos`, `/admin/caja`, `/admin/categorias`, and `/admin/pedidos` — MUST remain within the page width on narrow viewports. A table wider than the viewport MUST scroll horizontally within its own container rather than forcing the surrounding page layout to overflow. No table columns or data MAY be hidden or dropped to achieve this.

#### Scenario: Wide table scrolls within its container

- GIVEN the `/admin/productos` table is wider than a narrow (mobile) viewport
- WHEN the page renders at that width
- THEN the surrounding page layout MUST NOT overflow horizontally
- AND the table MUST be reachable by horizontal scroll inside its own container
- AND every column MUST still be present

#### Scenario: Applies to every admin data table

- GIVEN a narrow viewport
- WHEN the owner opens `/admin/caja`, `/admin/categorias`, or `/admin/pedidos`
- THEN each table MUST behave the same way: contained horizontal scroll, no page overflow, no dropped columns

### Requirement: In-Person Sale Payment Method Choice

`CajaRowActions`' "Vender 1" action MUST require staff to select a payment method — "Efectivo" (CASH) or "Transferencia" (TRANSFER) — before the sale request is submitted. The UI MUST block submission until one method is selected; there is no default/pre-selected method.

#### Scenario: Staff selects a payment method before selling

- GIVEN staff open the payment-method choice for a "Vender 1" action
- WHEN they select "Efectivo" and confirm
- THEN the POST request MUST include `paymentMethod: CASH` and the sale MUST proceed

#### Scenario: Submission blocked without a payment-method selection

- GIVEN staff open the payment-method choice for a "Vender 1" action
- WHEN they attempt to confirm without selecting either option
- THEN the UI MUST block submission and MUST NOT send the sale request

### Requirement: Sale Void Action Visibility

The admin console MUST surface an "Anular" action for a recorded `Sale`, and MUST hide or disable that action once the `Sale` is already voided.

#### Scenario: Anular action available for an active sale

- GIVEN a `Sale` has not been voided
- WHEN staff view it in the admin console
- THEN an "Anular" action MUST be available for it

#### Scenario: Anular action unavailable for an already-voided sale

- GIVEN a `Sale` has already been voided
- WHEN staff view it in the admin console
- THEN the "Anular" action MUST be hidden or disabled, preventing a second void attempt from the UI

### Requirement: Revenue Report Page and Navigation

The admin console navigation MUST include a link to a new revenue report page under `/admin/(console)`. The page MUST let staff choose between a single-day filter and a date-range filter and MUST render the aggregated totals per the `sales-revenue` capability's aggregation rules.

#### Scenario: Report reachable from the nav

- GIVEN staff are logged into the admin console
- WHEN they view the console navigation
- THEN a link to the revenue report page MUST be present

#### Scenario: Report offers both filter modes

- GIVEN staff open the revenue report page
- WHEN they choose a filter mode
- THEN they MUST be able to select either a single day or a start/end date range before the report renders totals
