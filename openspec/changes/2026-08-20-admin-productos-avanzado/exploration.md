# Exploration: Admin product edit — add variant, add/delete images

## Current State

`ProductRow.tsx` edit mode (`src/app/admin/(console)/productos/ProductRow.tsx:143-225`) is a single `<td colSpan={6}>` form with only name/price/categoryId/description, backed by `PATCH /api/admin/products/[id]` whose `validatePatchBody()` (`route.ts:37-69`) accepts exactly those 4 keys. Matches bugs.md item "solo permite editar precio, nombre y categoría" exactly.

`VariantRow.tsx` already provides inline edit (sku/size/color only, never `onHand` — design F7) + delete for **existing** variants, disclosed via `ProductRow`'s "Variantes" count click. It does not add a new variant.

`addVariant(prisma, productId, variant)` exists in `src/modules/catalog/product.service.ts:237-273` (validated, unit-tested at `product.service.test.ts:100`, rejects duplicate size+color) but has **zero callers outside its own test** — confirmed via grep across `src/`. No API route wraps it, no UI button exists anywhere. Pure wiring gap, not a logic gap.

No service function, route, or UI exists to add/remove a `ProductImage` on an already-created product. `NewProductForm.tsx`'s `uploadImages()` (`nuevo/NewProductForm.tsx:57-71`) only wires uploaded URLs into `createProduct()`'s payload at creation time. `POST /api/admin/upload/route.ts` is already product-agnostic (file in, `{url}` out) and reusable as-is — only the "attach url to existing product" and "delete image" steps are missing.

## Point 3 (bugs.md: "no permite eliminar un producto aún así no haya stock") — traced and refuted as a backend bug

- `deleteProduct()` (`product.service.ts:374-401`) reads all variants' `{id, sku, onHand}`; if any `onHand > 0`, throws `ProductHasStockError` **before** any delete attempt. It never calls `deleteVariant()` — it goes straight to `prisma.product.delete()`, which cascades `Variant`+`ProductImage` per `schema.prisma`'s `onDelete: Cascade`.
- `DELETE /api/admin/products/[id]/route.ts:131-169` calls `deleteProduct()` directly and correctly maps `ProductHasStockError`→409, `ProductHasHistoryError`→409, `ProductNotFoundError`→404. No path here touches `deleteVariant()` or `LastVariantError`.
- `LastVariantError` is thrown **only** by `deleteVariant()` (`product.service.ts:413-440`, when `siblingCount===1`) — reachable only via the variant-delete route, never via product delete.
- `route.test.ts` DELETE suite (230-321) covers 200-on-clean-product-with-`onHand=0` (cascade-verified), matching `openspec/specs/admin-console/spec.md` "Owner deletes a clean product."

**Conclusion**: confirmed UX/expectation mismatch, not a backend defect. Likely real sequence: admin deletes variants one-by-one, gets correctly blocked on the last one by `LastVariantError`, and wrongly assumes the product delete is also blocked — when it always worked. No functional fix belongs in this change's scope.

## Affected Areas

- `src/app/admin/(console)/productos/ProductRow.tsx` — new UI hooks for variant-add/image-add-delete, without touching the shipped/tested 4-field PATCH flow.
- `src/app/admin/(console)/productos/VariantRow.tsx` — pattern to mirror (self-contained sub-component, own fetch/confirm/error/`router.refresh()`).
- `src/app/admin/(console)/productos/nuevo/NewProductForm.tsx` — `uploadImages()`→`POST /api/admin/upload` pattern to reuse verbatim; file itself stays untouched.
- `src/modules/catalog/product.service.ts` — `addVariant()` reusable as-is; needs new `addImage()`/`deleteImage()` with typed errors matching existing convention.
- `src/app/api/admin/products/[id]/route.ts`, new `.../variants/route.ts` (POST), new `.../images/route.ts` (POST), new `.../images/[imageId]/route.ts` (DELETE) — thin-adapter pattern, reuse `POST /api/admin/upload` as-is.
- `prisma/schema.prisma` `ProductImage` model — no schema change anticipated.
- `openspec/specs/admin-console/spec.md` "Product and Variant Management" needs a MODIFIED delta: add-variant, duplicate-variant-on-add, add-image, delete-image scenarios. Point 3 needs no spec change.

## Hard constraints (non-goals)

- `onHand`/`held` must stay structurally non-editable everywhere (archived design.md F7, 2026-08-18-admin-productos-edicion). A new variant may only *set* initial `onHand` at creation, never edit an existing one's.
- No functional change to point 3 (delete-product-without-stock) — already works correctly.

## Approaches

1. **Fold variant/image management into ProductRow's existing edit-mode form** — Cons: conflates 3 independently-endpointed mutations into one submit; re-opens F9's already-shipped rationale. Effort: Medium.
2. **Self-contained "add variant" / image-gallery sub-components inside the already-expanded variants disclosure region**, mirroring `VariantRow.tsx` exactly; core-fields PATCH stays untouched. — Pros: zero risk to shipped flow, extends a proven pattern, each mutation gets its own thin route/typed error like every prior slice. Cons: 3 new routes instead of 1. Effort: Medium.
3. **New `/admin/productos/[id]/editar` page reusing NewProductForm wholesale** — already explicitly rejected by F9 for the original narrower scope; rationale still holds. Effort: High.

## Recommendation

Approach 2. New service functions `addImage(prisma, productId, {url, altText?, position?})` and `deleteImage(prisma, imageId)` alongside existing `addVariant()`. New routes: `POST /api/admin/products/[id]/variants` (wraps `addVariant`), `POST /api/admin/products/[id]/images` (wraps `addImage`, called after `/api/admin/upload`), `DELETE /api/admin/products/[id]/images/[imageId]` (wraps `deleteImage`). New UI: "Agregar variante" mini-form + image gallery with delete + file input inside `ProductRow`'s expanded region.

## Risks

- Bundling variant-add + image-add/delete is 2-3 largely-independent slices; cached `delivery_strategy: single-pr` — flag budget risk to `sdd-tasks` if forecast exceeds 800 lines.
- Open question: does deleting the last remaining image block, or is it freely allowed? Existing `isProductIncomplete()` already tolerates 0 images at creation — precedent favors "freely allowed," must be stated explicitly in design.
- New `addImage()`'s `url` is client-supplied post-upload — same trust boundary as `createProduct`'s existing `images` param (already re-encoded/sniffed upstream by `/api/admin/upload`), not new risk but worth naming explicitly.

## Open Questions (resolve before/at design)

1. Does deleting a product's last remaining image block, or is zero images always allowed (matching creation-time behavior)?
2. Does adding a variant to a product with existing order/stock history need any extra guard, or does it follow the exact same duplicate-size+color rule as `addVariant()` already enforces?

## Ready for Proposal

Yes.
