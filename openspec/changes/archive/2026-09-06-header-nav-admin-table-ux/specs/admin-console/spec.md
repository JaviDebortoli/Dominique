# Delta for admin-console

**Type**: Delta — modifies the existing `admin-console` capability. Adds two
self-contained requirements: one pinning single-open-at-a-time behavior for the
product table's inline edit forms, one requiring the admin data tables to stay
within the page width on narrow viewports. The large "Product and Variant
Management" requirement (the CRUD/API contract) is not restated or changed here;
these concerns are orthogonal to it.

## ADDED Requirements

### Requirement: Product Table Exclusive Edit Mode

On the `/admin/productos` table, at most one product row's inline edit form MUST
be open at any time. Opening the edit form on another row MUST close whichever
row was already open, discarding that row's unsaved field changes without
issuing a save. Closing an edit form — via its cancel action, `Escape`, or a
successful save — MUST return that row to view mode and MUST leave every row
free to be edited next. This requirement constrains only the product-field edit
form; the independent per-row expansion that shows a product's variants and
images is unaffected and MAY remain open regardless of edit state.

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

### Requirement: Admin Console Layout on Narrow Viewports

Each admin data table — `/admin/productos`, `/admin/caja`, `/admin/categorias`,
and `/admin/pedidos` — MUST remain within the page width on narrow viewports. A
table wider than the viewport MUST scroll horizontally within its own container
rather than forcing the surrounding page layout to overflow. No table columns or
data MAY be hidden or dropped to achieve this.

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
