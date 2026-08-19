# Proposal: Admin Product and Variant Edit and Delete

## Intent

`/admin/productos` is create-and-list only: `listAllProductsForAdmin` renders a static table with no row actions, and `POST /api/admin/products` is the sole route. A mistyped price, a wrong category, or a discontinued item has no path back except direct DB access. `2026-08-18-admin-categorias-edicion` closed that gap for categories; this closes it for products and variants, reusing the same shape. `specs/admin-console/spec.md` still documents creation only.

## Scope

### In Scope

- `updateProduct(prisma, id, {name, description, price, categoryId})` — `slug` never written
- `deleteProduct(prisma, id)` — hard delete, cascades Variants/Images; blocked on history or stock
- `updateVariant(prisma, variantId, {sku, size?, color?})` — `sku` duplicate-checked; `size`/`color` rejected once the variant has `OrderItem` rows
- `deleteVariant(prisma, variantId)` — blocked on history, `onHand > 0`, or last-variant-standing
- Typed errors mirroring `CategoryHasProductsError`: history-blocked, stock-blocked, last-variant, not-found, duplicate-SKU, immutable-attribute
- `PATCH`/`DELETE /api/admin/products/[id]` and `.../[id]/variants/[variantId]` — new thin adapters, own `auth()` gate per handler
- Row edit/delete affordances on `/admin/productos` with `confirm()`-gated delete
- `admin-console` spec delta

### Out of Scope

- Editing `slug` — immutable, public URL with no redirect mechanism
- `onHand`/`held` — owned by `/admin/caja` + `stock.service.ts adjust()`; the form must not expose them
- Soft delete, `isActive`, deactivation, any schema migration
- `size`/`color` on a variant with order history; bulk/mass operations

## Capabilities

### New Capabilities

- None

### Modified Capabilities

- `admin-console`: "Product and Variant Management" gains product edit, product delete, variant edit, variant delete, and the four blocking rules (history, stock, last-variant, attribute immutability)

## Approach

Mirror the shipped categories slice: logic in `product.service.ts`, routes as thin adapters, page stays an RSC. Delete relies on the database first — catch Prisma `P2003` from the existing `ON DELETE RESTRICT` FKs (`order_items_variantId_fkey`, `stock_movements_variantId_fkey`) exactly as `deleteCategory` does, so no TOCTOU window opens.

Two guards the database cannot express are added in the service, inside the same transaction as the delete: `onHand > 0` (initial stock is written directly by `createProduct` with no `StockMovement` row, so RESTRICT cannot see it) and last-variant-standing (a Product must keep ≥1 Variant). `sku` collisions reuse `addVariant`'s `findFirst` + `P2002` catch.

## Affected Areas

| Area | Impact | Description |
|------|--------|-------------|
| `src/modules/catalog/product.service.ts` | Modified | 4 mutators + typed errors |
| `src/app/api/admin/products/[id]/route.ts` | New | Product PATCH + DELETE |
| `src/app/api/admin/products/[id]/variants/[variantId]/route.ts` | New | Variant PATCH + DELETE |
| `src/app/admin/(console)/productos/page.tsx` | Modified | Row action column |
| `src/app/admin/(console)/productos/` | New | Edit/delete client components |
| `src/modules/inventory/stock.service.ts` | Unchanged | Sole owner of `onHand` |
| `prisma/schema.prisma` | Unchanged | No migration |

## Risks

| Risk | Likelihood | Mitigation |
|------|------------|------------|
| Delete legitimately fails for most real products — `hold()` writes a `StockMovement` on every cart hold, so a variant merely added to a cart once is permanently undeletable | **High** | Accepted and structural. UI copy MUST NOT sell delete as routine: the blocked message states the concrete reason (`"No se puede eliminar: tiene movimientos de stock o ventas registradas."`) and the real alternative (edit it, or stop stocking it) |
| Owner reads a blocked delete as a bug | High | Distinct messages per cause — history vs. `onHand > 0` vs. last variant — never one generic failure |
| Blocked product delete leaves partial state | Low | One Postgres statement; cascade fails atomically, removes nothing |
| Price edit changes what past orders appear to have cost | Med | `OrderItem` stores its own price; verify during design |
| Second/third non-POST routes deepen divergence from all-POST convention | Low | Deliberate, precedent set by categories |

## Rollback Plan

Additive only — no migration, no change to create or any read path. Revert the PR: both `[id]` routes, the row actions, and the four service functions disappear. Applied edits remain valid rows; deleted records could only ever have been ones with no history and no stock.

## Dependencies

- None. Uses shipped auth, Prisma client, and Editorial Minimalist tokens.

## Success Criteria

- [ ] Owner edits a product's name, description, price, and category from `/admin/productos` with no DB access, and its `slug` is unchanged
- [ ] A `slug` sent to `PATCH` never reaches the database
- [ ] Deleting a product or variant with order/stock history removes nothing and returns a readable, cause-specific message
- [ ] Deleting a variant with `onHand > 0` is blocked even when it has no `StockMovement` row
- [ ] Deleting a product's last remaining variant is blocked; deleting the product itself succeeds when clean
- [ ] Editing `size`/`color` on a variant with `OrderItem` rows is rejected; `sku` still edits, duplicates return 409
- [ ] No edit surface exposes `onHand` or `held`
- [ ] Unauthenticated `PATCH`/`DELETE` return JSON `401` and mutate nothing

## Open Decisions — RESOLVED (owner, before spec/design)

- **Delete mechanism**: hard delete. Blocked by (a) `OrderItem`/`StockMovement` history via `P2003`, or (b) `onHand > 0` via a new application-level check. No soft delete, no `isActive`, no migration.
- **`onHand`/stock editing**: out of scope; `/admin/caja` + `adjust()` remain the only path.
- **Last-variant-standing**: blocked. Delete the Product to remove it entirely.
- **`size`/`color` with order history**: immutable. `sku` stays editable.
- **Product `slug`**: immutable after creation.

## Refinements — RESOLVED (owner, before spec/design)

- **Price edit and order history — CONFIRMED, not a risk.** Verified `OrderItem.unitPrice` (`prisma/schema.prisma:144`) is its own field, a snapshot taken at purchase time, independent of `Product.price`. Editing a product's price never rewrites what a past order displays. `price` stays freely editable with no history guard. The Risks table's "Med" entry on this is downgraded to resolved/non-issue.
- **Delete affordance framing**: the delete action is always clickable (same shape as categories) — never pre-disabled based on known-undeletable state. A blocked delete surfaces its cause-specific message only after the owner clicks `confirm()` and the request comes back rejected. No client-side precomputation of history/stock/last-variant state before the click.
