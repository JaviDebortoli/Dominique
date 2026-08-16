# Delta for admin-console

**Type**: Delta — modifies the existing `admin-console` capability (no new capability domain). Adds category-creation scenarios to requirements already present in `openspec/specs/admin-console/spec.md`.

## MODIFIED Requirements

### Requirement: Authenticated Access

The admin console MUST require authentication; unauthenticated requests MUST be blocked from all admin routes, including standalone `/api/admin/*` route handlers that sit outside the console route-group's middleware matcher and therefore MUST verify the session independently.

(Previously: covered redirect-to-login for admin page routes only; now also covers standalone admin API route handlers that respond with JSON instead of redirecting.)

#### Scenario: Unauthenticated access blocked

- GIVEN a user is not logged in
- WHEN they request an admin route
- THEN the system MUST redirect them to login and MUST NOT expose admin data or actions

#### Scenario: Unauthenticated request to an admin API route

- GIVEN a user has no valid session
- WHEN they call `POST /api/admin/categories` directly
- THEN the system MUST respond `401 Unauthorized` as JSON
- AND MUST NOT create a category

### Requirement: Product and Variant Management

Staff MUST be able to create, edit, and deactivate products, categories, variants, and stock quantities, including image upload, without engineering assistance. Category creation MUST validate `slug` against `/^[a-z0-9]+(-[a-z0-9]+)*$/` before any database write, and MUST reject a `slug` already in use without creating a duplicate row.

(Previously: prose already referenced category management; this adds the category-creation path, its slug validation rule, and duplicate-slug rejection, none of which existed before.)

#### Scenario: Owner adds a product unaided

- GIVEN the owner is logged into admin
- WHEN they create a new product with size/color variants, stock counts, and images
- THEN the product SHALL be saved and immediately available for storefront listing (once activated)

#### Scenario: Owner creates a category unaided

- GIVEN the owner is logged into `/admin/categorias`
- WHEN they submit `name: "Bijoutería"` with the slug left at its auto-suggested value
- THEN the category SHALL be saved
- AND SHALL immediately appear in the product form's category picker and in the categories list with a product count of 0

#### Scenario: Duplicate slug rejected

- GIVEN a category with slug `bijouteria` already exists
- WHEN the owner submits a new category whose slug also resolves to `bijouteria`
- THEN the system MUST respond `409 Conflict` with a readable message (e.g. "Ya existe una categoría con esta URL")
- AND MUST NOT create any new row

#### Scenario: Invalid slug rejected before the database

- GIVEN the owner submits a slug containing spaces, uppercase letters, or accented characters (e.g. `Ropa Íntima`)
- WHEN the request reaches `POST /api/admin/categories`
- THEN the system MUST reject it with a validation error before any database write
- AND MUST NOT reach Prisma or the database

#### Scenario: Slug auto-suggestion strips accents

- GIVEN the owner types `name: "Bijoutería"` into the create form
- WHEN the slug field has not been hand-edited
- THEN the suggested slug SHALL normalize accents to ASCII (Unicode NFD, strip combining marks) before kebab-casing, producing `bijouteria`
- AND the suggested slug SHALL satisfy `/^[a-z0-9]+(-[a-z0-9]+)*$/`
- AND the display `name` SHALL keep its original accents unchanged

#### Scenario: Empty category displays as-is on the storefront

- GIVEN a category has zero products
- WHEN a customer browses to that category's storefront page
- THEN the page SHALL render using the existing null-safe thumbnail handling
- AND no new filtering or hiding logic SHALL exclude the empty category from view
