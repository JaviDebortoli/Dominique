# Delta for admin-console

**Type**: Delta — modifies `admin-console`. Adds category rename/delete to requirements in `openspec/specs/admin-console/spec.md`.

## MODIFIED Requirements

### Requirement: Authenticated Access

The admin console MUST require authentication; unauthenticated requests MUST be blocked from all admin routes, including standalone `/api/admin/*` route handlers that sit outside the console route-group's middleware matcher and therefore MUST verify the session independently.

(Previously: covered unauthenticated `POST /api/admin/categories` only; now also covers `PATCH`/`DELETE` on `/api/admin/categories/[id]`.)

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

### Requirement: Product and Variant Management

Staff MUST be able to create, rename, and delete categories, and create products, variants, and stock, without engineering assistance. Category creation MUST validate `slug` and reject a duplicate. `PATCH /api/admin/categories/[id]` MUST update `name` only. `slug` MUST stay immutable: if the payload includes a `slug` key at all, the system MUST reject the whole request with `400 Bad Request` and MUST NOT mutate the category — never silently strip the key and apply the rest. A `name`-only payload MUST return `409 Conflict` on a case-insensitive collision with another category's `name`. `DELETE /api/admin/categories/[id]` MUST succeed when the category has zero products, and MUST be blocked with a typed error stating the exact assigned-product count otherwise. `PATCH`/`DELETE` on a non-existent id MUST return `404 Not Found`. Deactivation is NOT delivered: `Category` has no `isActive` field.

(Previously: covered creation, slug validation, and duplicate-slug rejection; this adds rename, slug immutability, duplicate-name rejection, delete, delete-blocked, not-found handling, and the deactivation gap.)

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
