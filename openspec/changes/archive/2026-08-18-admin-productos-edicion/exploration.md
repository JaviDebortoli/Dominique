# Exploration: Admin product and variant edit/delete

## Current State

`/admin/productos` (`src/app/admin/(console)/productos/page.tsx`) is a read-only RSC table via `listAllProductsForAdmin(prisma)` (`src/modules/catalog/product.service.ts:226`) — name/category/price/variant-count/image-count, no row actions. `POST /api/admin/products` (`src/app/api/admin/products/route.ts`) is the only route; `createProduct` (`product.service.ts:81`) checks only in-payload size+color duplicates (`findDuplicatePair` → `DuplicateVariantError`) and has no P2002 catch on the DB write, unlike `addVariant` (`product.service.ts:127`), which already does `findFirst` + P2002-catch → `DuplicateVariantError` — that's the template for variant duplicate handling on edit.

The direct precedent, archived `2026-08-18-admin-categorias-edicion`, added `renameCategory`/`deleteCategory` + typed errors (`CategoryHasProductsError`, `CategoryNotFoundError`, `DuplicateCategoryNameError`), a `PATCH`/`DELETE` `[id]/route.ts` (first non-POST route under `src/app/api/**`, `RouteContext { params: Promise<{id}> }`, own `auth()` check per handler), and an inline-edit `<tr>` client component with `confirm()`-gated delete + `router.refresh()`. That whole shape is the template to mirror.

## Affected Areas

- `src/modules/catalog/product.service.ts` — needs `updateProduct`, `deleteProduct`, `updateVariant`, `deleteVariant`, and new typed errors mirroring `CategoryHasProductsError`/`CategoryNotFoundError`.
- `src/app/api/admin/products/[id]/route.ts` — new, `PATCH`/`DELETE` for a Product (does not exist today).
- `src/app/api/admin/products/[id]/variants/[variantId]/route.ts` (or similar) — new, `PATCH`/`DELETE` for a single Variant.
- `src/app/admin/(console)/productos/page.tsx` — needs row actions column, currently static.
- `src/app/admin/(console)/productos/nuevo/NewProductForm.tsx` — precedent for form shape, not directly modified.
- `openspec/specs/admin-console/spec.md` — "Product and Variant Management" only documents creation today; needs a delta.
- `src/modules/inventory/stock.service.ts`, `/admin/caja`, `CajaRowActions.tsx` — already own stock/onHand editing; must stay untouched/out of scope.

## Fact-checked Prisma delete/FK behavior (`prisma/migrations/20260812231809_init/migration.sql`)

| FK | Clause |
|---|---|
| `products_categoryId_fkey` | `ON DELETE RESTRICT` (confirms categories precedent) |
| `product_images_productId_fkey` | `ON DELETE CASCADE` |
| `variants_productId_fkey` | `ON DELETE CASCADE` |
| `order_items_variantId_fkey` | **`ON DELETE RESTRICT`** |
| `stock_movements_variantId_fkey` | **`ON DELETE RESTRICT`** |
| `stock_movements_orderId_fkey` | `ON DELETE SET NULL` |

Deleting a Variant (or a Product whose cascade touches it) that has any `OrderItem` or `StockMovement` row fails atomically → Prisma `P2003`, same shape as `CategoryHasProductsError`. Because it's one Postgres statement, a blocked Product delete removes nothing — no partial cascade.

**Severity finding**: `hold()` (`stock.service.ts:93`) writes a `StockMovement` row (`reason: HOLD`) on every cart hold, and `release()` writes another on cancel/expiry — the original row is never deleted. So a variant that was merely added to a cart once, even if never purchased, already has a permanent `StockMovement` row and can never be hard-deleted once RESTRICT fires. This makes delete-after-history the common case, not an edge case, once there's real traffic — much broader than the categories precedent's "populated category" risk.

## Approaches

1. **Mirror categories precedent exactly (hard delete + typed RESTRICT-catch errors)** — service functions + typed errors in `product.service.ts`, thin `[id]/route.ts` adapters, inline-edit row components.
   - Pros: consistent with shipped conventions, minimal new patterns, fast to build.
   - Cons: given the severity finding above, delete will be blocked for nearly every variant/product with any real usage — the "delete" feature may rarely succeed in practice.
   - Effort: Medium.

2. **Soft-delete/deactivate flag (`isActive` on Product/Variant) instead of hard delete** — matches the same schema gap the categories change already flagged ("no isActive field... same gap Product has").
   - Pros: works even after order history exists; matches real owner need (hide a discontinued item) better than hard delete.
   - Cons: requires a schema migration (categories change explicitly stayed additive/no-migration); broader scope than "mirror the precedent."
   - Effort: Medium-High.

## Recommendation

Ship Approach 1 for the pieces that are safe and unambiguous now (slug stays immutable, `sku`/size+color duplicate handling mirrors `addVariant`, delete blocked via typed P2003-catch errors exactly like categories), but do not proceed to `sdd-propose` until the owner resolves the open questions below — this mirrors how the categories change required an "Open Decisions — RESOLVED (owner...)" section before design started.

## Risks

- Hard delete may be near-useless once traffic exists (RESTRICT fires on any historically-held variant) — the UX must not oversell "delete" if it's rarely achievable.
- No order-line snapshot exists in the schema (`OrderItem.variantId` is a live FK, not a denormalized copy of size/color/price) — editing a variant's `size`/`color` after it has `OrderItem` history silently rewrites what a past order appears to have been.
- Nothing in the schema prevents a Product from ending up with zero Variants if a "delete variant" endpoint ships without a last-variant guard.
- `onHand`/stock must stay out of this change's edit form — `/admin/caja` + `stock.service.ts adjust()` already own it, and bypassing the conditional-UPDATE path risks the `onHand>=held`/`onHand>=0` invariants.

## Open Questions (block sdd-propose until resolved)

1. **Delete-after-order-history is the common case, not the edge case.** Hard delete (blocked via P2003 once any hold/order history exists) vs. a soft-delete/deactivate flag (requires schema migration, out of the categories change's additive-only precedent). Which do we ship?
2. **onHand editing bypass risk** — confirmed OUT of scope: `/admin/caja` (`CajaRowActions.tsx` + `POST /api/admin/stock/adjust` → `stock.service.ts adjust()`) already owns stock correction (spec-backed, "Manual Admin Reconciliation"). The product/variant edit form must NOT expose `onHand`/`held`.
3. **Slug immutability** — confirmed identical risk to categories: `src/app/(store)/producto/[slug]/page.tsx` resolves via `getProductBySlug`'s `findUnique({ where: { slug } })`, no redirect/alias mechanism. Recommend immutable, same as categories.
4. **Product vs. Variant delete risk profiles + last-variant-standing rule** — Product delete cascades (CASCADE) to all Variants/Images but transitively fails if any variant has order/stock history (RESTRICT propagates). Variant delete has no "last variant standing" guard in the schema today — should deleting the last variant of a product be blocked?
5. **Editing size/color/sku on a variant with OrderItem history** — `sku`'s global uniqueness reuses the existing `addVariant` P2002-catch pattern (low risk). `size`/`color` changes on a variant with existing `OrderItem` rows are a genuine product-history-integrity gap: no snapshot layer exists, so a past order's displayed size/color can drift after the fact. Block editing size/color once a variant has order history, or accept the drift?
6. **Spec/test conventions** — `openspec/specs/admin-console/spec.md`'s "Product and Variant Management" requirement only documents creation; needs a MODIFIED delta. Test patterns to mirror: `product.service.test.ts` (real Postgres, `randomUUID()` suffixes, `afterAll` cleanup), `route.test.ts` (`vi.mock("@/lib/auth", () => makeAuthMockModule())`), and `e2e/admin-console.spec.ts` (already covers product creation and category rename/delete end-to-end).

## Open Decisions — RESOLVED (owner, before proposal)

- **Delete mechanism**: hard delete, mirroring categories. Blocked when: (a) the variant/product has any `OrderItem`/`StockMovement` history (caught via Prisma `P2003` from the existing `ON DELETE RESTRICT` FKs), **or (b) the variant has `onHand > 0`** — a NEW application-level rule, since initial stock set at creation writes no `StockMovement` row and the DB constraint alone cannot catch it. No soft-delete/`isActive` flag, no schema migration.
- **onHand/stock editing**: OUT of scope. `/admin/caja` + `stock.service.ts`'s `adjust()` remain the only path to change `onHand`. The product/variant edit form must not expose `onHand`/`held`.
- **Last-variant-standing**: blocked. A product must always have at least one variant; deleting a product's only remaining variant is rejected. To remove a product entirely, delete the product itself (cascades all its variants).
- **Editing size/color on a variant with order history**: blocked. Once a variant has any `OrderItem` row, `size`/`color` become immutable (prevents a past order from silently displaying different attributes than what was actually purchased). `sku` and stock remain editable through their own existing rules/flows.
- **Product slug**: immutable after creation, same rationale as categories (no redirect mechanism for `/producto/{slug}`).

## Ready for Proposal

Yes.
