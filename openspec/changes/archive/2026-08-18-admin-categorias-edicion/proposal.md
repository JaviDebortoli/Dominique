# Proposal: Admin Category Edit and Delete

## Intent

`2026-08-16-admin-categorias` shipped category creation and explicitly deferred rename ("revisit after apply"). This is that revisit. Today the owner who mistypes "Bijuteria" or creates a category she no longer sells has no path back: `/admin/categorias` is create-and-list only, so fixing either mistake needs direct DB access. `specs/admin-console/spec.md` already promises staff can "create, **edit**, and deactivate ... categories" but only create exists. This closes the edit/delete half of that promise and corrects the prose it cannot deliver.

## Scope

### In Scope
- `renameCategory(prisma, id, {name})` — updates `name` only; `slug` is never written
- `deleteCategory(prisma, id)` + typed `CategoryHasProductsError` (maps Prisma `P2003` from the FK's `ON DELETE RESTRICT`)
- `PATCH /api/admin/categories/[id]` and `DELETE /api/admin/categories/[id]` — new `[id]/route.ts`, own `auth()` gate, typed-error → status mapping
- Per-row edit and delete affordances in the `/admin/categorias` table, with delete confirmation
- Spec delta correcting "Product and Variant Management" to match delivered behavior

### Out of Scope
- Editing `slug` — immutable after creation (a public URL segment with no redirect mechanism)
- Reassigning or bulk-moving products between categories
- Category deactivation/archiving — no `isActive` field exists on `Category` (same gap `Product` has); the spec delta names it a known gap rather than promising it
- Any "Uncategorized" fallback category, nullable `categoryId`, or schema migration

## Capabilities

### New Capabilities
- None

### Modified Capabilities
- `admin-console`: "Product and Variant Management" gains category rename and category delete scenarios, a delete-blocked-by-products rule, a slug-immutability rule, and an explicit note that "deactivate" is not schema-backed

## Approach

Mirror the shipped creation slice: logic in `category.service.ts`, route as thin adapter, page stays put. `deleteCategory` catches `P2003` exactly as `createCategory` catches `P2002` — no pre-count check, so the database constraint stays the single source of truth and no TOCTOU window opens.

The route uses real `PATCH`/`DELETE` verbs on a resource-scoped `[id]` path — the first non-POST handler in `src/app/api/**`, chosen because these are true resource edit/delete semantics, unlike `orders/[orderId]/pickup`'s POST action. Existing `POST /api/admin/categories` is untouched.

`PATCH` accepts `{name}` only; a `slug` key in the payload is ignored or rejected, never written. The UI reuses the existing Editorial Minimalist tokens and the `router.refresh()` stay-on-page pattern from `NewCategoryForm`.

## Affected Areas

| Area | Impact | Description |
|------|--------|-------------|
| `src/modules/catalog/category.service.ts` | Modified | Rename + delete + `CategoryHasProductsError` |
| `src/app/api/admin/categories/[id]/route.ts` | New | PATCH + DELETE adapter |
| `src/app/admin/(console)/categorias/page.tsx` | Modified | Row action column |
| `src/app/admin/(console)/categorias/` | New | Edit/delete client component(s) |
| `src/app/api/admin/categories/route.ts` | Unchanged | POST create stays as-is |
| `prisma/schema.prisma` | Unchanged | `ON DELETE RESTRICT` already enforces the block |

## Risks

| Risk | Likelihood | Mitigation |
|------|------------|------------|
| Owner cannot delete a populated category and has no bulk-reassign path | High | Accepted; error copy must state the reason and the manual fix (reassign products first) |
| Rename drifts `name` away from its frozen `slug` | Med | Intended; slug is a permanent URL, name is a label. Surface the slug read-only in the edit UI |
| Two categories renamed to the same `name` | Med | Only `slug` is `@unique`; duplicate display names are permitted. Flagged for owner review |
| First `PATCH`/`DELETE` route diverges from all-POST convention | Low | Deliberate and documented here; no existing route changes |

## Rollback Plan

Additive only — no migration, no change to create or to any read path. Revert the PR: the `[id]` route, the row actions, and the two service functions disappear. Renames already applied remain valid `Category` rows; deleted categories are gone but could only ever have been empty ones.

## Dependencies

- None. Uses the shipped auth, Prisma client, and design tokens.

## Success Criteria

- [ ] Owner renames a category from `/admin/categorias` with no DB access, and its `slug` is unchanged
- [ ] The renamed label appears in the product form's category picker and on the storefront
- [ ] Deleting a category with products returns a readable blocking error and removes nothing
- [ ] Deleting an empty category removes it and the list refreshes in place
- [ ] A `slug` sent to `PATCH` never reaches the database
- [ ] Unauthenticated `PATCH`/`DELETE` return JSON `401` and mutate nothing

## Open Decisions — RESOLVED (owner, before spec/design)

- **Slug**: immutable after creation. Edit changes `name` only; the route must not write `slug`.
- **Delete with products**: blocked via typed `CategoryHasProductsError` from `P2003`. No reassignment flow.
- **Route verbs**: real `PATCH` and `DELETE` on `src/app/api/admin/categories/[id]/route.ts`.

## Refinements — RESOLVED (owner, before spec/design)

- **Duplicate names**: `renameCategory` MUST reject a name that collides case-insensitively with another existing category's name (409, mirrors `DuplicateCategorySlugError`'s shape — e.g. `DuplicateCategoryNameError`). Not just `slug` anymore.
- **Delete confirmation**: a native `confirm()` dialog naming the category (e.g. `¿Eliminar "Vestidos"?`) is sufficient — no type-to-confirm.
- **Blocked-delete error copy**: MUST include the product count, e.g. `"No se puede eliminar: tiene 12 productos asignados."` — `CategoryHasProductsError` needs the count available (from the same query/transaction, not an extra round-trip if avoidable).
- **Slug regeneration exception**: rejected. Slug stays immutable with zero exceptions, even for a category with 0 products — one simple rule, no conditional logic in the service.
