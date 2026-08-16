# Proposal: Admin Category Creation

## Intent

`specs/admin-console/spec.md` "Product and Variant Management" already requires staff to manage **categories** without engineering assistance, but no such path was ever built. Today categories exist only via `prisma/seed.ts`'s `seedCatalogFixtures()` (Vestidos / Remeras / Accesorios — dev+E2E fixtures, not real catalog). The product form's category `<select>` can only offer rows that already exist, so the owner cannot add "Bijou" or "Calzado" without direct DB access. This blocks real catalog provisioning before launch. Closing the gap is small, low-risk, and unblocks the owner.

## Scope

### In Scope
- `createCategory(prisma, {name, slug})` + typed `DuplicateCategorySlugError` (maps Prisma `P2002` on `slug`)
- `listAllCategoriesForAdmin(prisma)` — categories + product count, ordered by name
- `POST /api/admin/categories` — own `auth()` gate, type-guard validation, typed-error → status mapping
- `/admin/categorias` — one page: list + inline create form (name, slug)
- Slug auto-suggested (kebab-case) from name until hand-edited; stays editable
- `Categorías` nav link in the admin console shell

### Out of Scope
- Editing an existing category (deferred; ask owner after apply)
- Deleting a category — needs a product-reassignment decision first
- Category images, ordering, nesting, or activation flags
- Any schema migration; any change to product creation

## Capabilities

### New Capabilities
- None

### Modified Capabilities
- `admin-console`: add a scenario proving the owner can create a category unaided, and that a duplicate slug is rejected rather than silently shadowing the public `/categoria/[slug]` route

## Approach

Mirror the shipped product-creation slice exactly (design.md D1: logic in the module, route is a thin adapter):
`category.service.ts` gains the write path → `route.ts` mirrors `api/admin/products/route.ts` → RSC list page + client form mirrors `productos/page.tsx` + `NewProductForm.tsx`, reusing the existing Editorial Minimalist tokens (no new visual direction). Slug validation is **stricter** than the product route's non-empty check — `/^[a-z0-9]+(-[a-z0-9]+)*$/` — because this slug becomes a public URL segment. On success the form calls `router.refresh()` and stays put; no redirect.

`/api/admin/*` is deliberately outside `src/proxy.ts`'s `matcher: ["/admin/:path*"]`, so the new route checks its own session and returns JSON 401.

## Affected Areas

| Area | Impact | Description |
|------|--------|-------------|
| `src/modules/catalog/category.service.ts` | Modified | Add create + admin list + error class |
| `src/app/api/admin/categories/route.ts` | New | POST adapter |
| `src/app/admin/(console)/categorias/` | New | Page + `NewCategoryForm.tsx` |
| `src/app/admin/(console)/layout.tsx` | Modified | Nav link |
| `prisma/schema.prisma` | Unchanged | `slug @unique` already enforces it |

## Risks

| Risk | Likelihood | Mitigation |
|------|------------|------------|
| Duplicate slug shadows a live public URL | Med | DB `@unique` + `P2002` → typed 409 with actionable copy |
| Free-text slug breaks `/categoria/[slug]` | Med | Regex validation server-side, not only in the form |
| Owner creates a category then can't rename it | Med | Known gap; edit is the next slice |
| Empty category renders a bare storefront tile | Low | Existing behavior: `thumbnailUrl` is already null-safe |

## Rollback Plan

Additive only — no migration, no change to existing read paths. Revert the PR: the nav link, page, route, and service functions disappear; already-created category rows remain valid and keep working (they are ordinary `Category` rows, indistinguishable from seeded ones).

## Dependencies

- None. Uses the shipped auth, Prisma client, and design tokens.

## Success Criteria

- [ ] Owner creates a real category from `/admin/categorias` with no DB access
- [ ] The new category appears immediately in the product form's picker
- [ ] A duplicate slug returns 409 with a readable message, creating nothing
- [ ] An invalid slug (spaces, uppercase, accents) is rejected before the DB
- [ ] The list shows each category's product count, and an empty-state invitation when there are none

## Open Decisions — RESOLVED (owner, before spec/design)

- **Empty category on storefront**: shown as-is (existing null-safe thumbnail behavior). No new filtering logic.
- **Accented names**: display `name` keeps accents (e.g. "Bijoutería"); the auto-suggested `slug` strips diacritics to ASCII (`bijouteria`) before applying the `/^[a-z0-9]+(-[a-z0-9]+)*$/` validation. The slug-suggestion function must normalize (`NFD` + strip combining marks) before kebab-casing.
- **Rename**: stays out of scope for this change, confirmed. Ask again after apply, per the original plan.
