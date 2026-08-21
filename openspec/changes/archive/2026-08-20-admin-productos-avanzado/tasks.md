# Tasks: Admin Product Variant Add and Image Management

> Strict TDD active. Every implementation task is preceded by its RED test (written first, failing) — shown as combined `RED→GREEN` lines, mirroring `openspec/changes/archive/2026-08-18-admin-productos-edicion/tasks.md`'s convention.

## Review Workload Forecast

| Field | Value |
|-------|-------|
| Estimated changed lines | ~1,545 total (additions + deletions) |
| Session review budget | 800 lines |
| 400-line budget risk | High — ~1.9x the 800-line session budget |
| Chained PRs recommended | Yes — the design itself frames this as two largely independent slices with no functional dependency: variant-add (route + form, does not touch `product.service.ts` since `addVariant` is unmodified) and image add/delete (service + 2 routes + gallery component) |
| Suggested split | PR 1 (variant-add: route + `AddVariantForm` + its `ProductRow` mount + e2e) → PR 2 (image add/delete: service + 2 routes + `ProductImages` + its `ProductRow` mount + e2e) |
| Delivery strategy | single-pr (cached) |
| Chain strategy | pending — single-pr requires `size:exception` before apply; given High risk (~1.9x budget) and that the two slices are functionally independent (unlike a strict dependency chain), **stacked-to-main with 2 PRs** is the recommended alternative to a size exception, but the user must resolve this before `sdd-apply` |

**Per-file basis**: `variants/route.ts` ~90 (new, POST only) / `variants/route.test.ts` ~150 (new) / `AddVariantForm.tsx` ~110 (new) / `AddVariantForm.test.tsx` ~90 (new) / `product.service.ts` additions ~90 (`addImage`, `deleteImage`, `AddImageInput`, `TooManyImagesError`, `ProductImageNotFoundError`) / `product.service.test.ts` additions ~150 / `images/route.ts` ~90 (new, POST only) / `images/route.test.ts` ~140 (new) / `images/[imageId]/route.ts` ~60 (new, DELETE only) / `images/[imageId]/route.test.ts` ~100 (new) / `ProductImages.tsx` ~180 (new, two-step upload flow) / `ProductImages.test.tsx` ~160 (new) / `ProductRow.tsx` diff ~15 (two new `<tr>` mounts, G9) / `ProductRow.test.tsx` diff ~30 / `e2e/admin-productos-avanzado.spec.ts` ~90 (new, 3 scenarios).

Decision needed before apply: Yes
Chained PRs recommended: Yes
Chain strategy: pending
400-line budget risk: High

### Suggested Work Units

| Unit | Goal | Likely PR | Focused test command | Runtime harness | Rollback boundary |
|------|------|-----------|----------------------|-----------------|-------------------|
| 1 | Variant-add: `POST .../products/[id]/variants` route (G5/G6) + `AddVariantForm` + its `ProductRow` mount + variant-add e2e scenario | PR 1 | `npm test -- "src/app/api/admin/products/[id]/variants/route.test.ts"` then `npm test -- AddVariantForm.test.tsx` | `npx playwright test e2e/admin-productos-avanzado.spec.ts -g "agrega una variante"` against seeded local Postgres | Revert PR: `variants/route.ts`, `AddVariantForm.tsx`, and their tests disappear; `ProductRow.tsx`'s `AddVariantForm` mount reverts; `addVariant()` itself is untouched and stays callable by any other future caller |
| 2 | Image add/delete: `addImage`/`deleteImage` in `product.service.ts` (G1-G4) + 2 image routes + `ProductImages` gallery + its `ProductRow` mount + image e2e scenarios | PR 2 | `npm test -- product.service.test.ts` then `npm test -- "src/app/api/admin/products/[id]/images"` then `npm test -- ProductImages.test.tsx` | `npx playwright test e2e/admin-productos-avanzado.spec.ts -g "imagen"` against seeded local Postgres (independent of PR 1's variant flow) | Revert PR: `addImage`/`deleteImage`/`TooManyImagesError`/`ProductImageNotFoundError` disappear from `product.service.ts`, both image routes disappear, `ProductImages.tsx` disappears, `ProductRow.tsx`'s `ProductImages` mount reverts; PR 1's variant-add flow is unaffected |

## Phase 1: Variant-Add Route (PR 1)

- [x] 1.1 RED: create `src/app/api/admin/products/[id]/variants/route.test.ts` (mirrors `variants/[variantId]/route.test.ts`: `vi.mock("@/lib/auth", () => makeAuthMockModule())`, real Postgres, seed a product + one variant per test) — `POST`: 201 `{id,sku,size,color}` with `onHand: 0` persisted; 400 `invalid_request` for unparseable JSON / missing or empty `size`,`color`,`sku`; 400 `stock_not_editable` when the body carries an `onHand` key AND separately when it carries a `held` key, asserting no variant is created (G5); 401, mutates nothing; 404 `product_not_found` for an unknown product id (G6); 409 `duplicate_variant` reusing `addVariant()`'s existing `DuplicateVariantError` for a same size+color request, with Spanish copy built from `error.size`/`error.color` (E4).
- [x] 1.2 GREEN: create `src/app/api/admin/products/[id]/variants/route.ts` — `RouteContext { params: Promise<{ id: string }> }`. `auth()` gate first, parse JSON (catch → 400 `invalid_request`), reject an `onHand`/`held` key in the body → 400 `stock_not_editable` (structurally never construct an `onHand` property on the object passed to `addVariant`, G5), trim/validate `size`/`color`/`sku` → 400 on empty, `await context.params`, resolve the product with a PK existence read → 404 `product_not_found` if null (G6), call `addVariant(prisma, productId, { size, color, sku })` UNMODIFIED, catch `DuplicateVariantError` → 409 `duplicate_variant`, else rethrow (500), return 201.

## Phase 2: Variant-Add UI (PR 1)

- [x] 2.1 RED: create `src/app/admin/(console)/productos/AddVariantForm.test.tsx` (mirrors `VariantRow.test.tsx`: `@testing-library/react` + `user-event`, stubbed `fetch`, mocked `useRouter`) — renders `Talle`/`Color`/`SKU` inputs and an `Agregar` button; NO stock input rendered anywhere; `Agregar` POSTs `.../products/{productId}/variants` with exactly `{size,color,sku}` and never an `onHand`/`held` key; a stubbed non-2xx response renders `message` in `role="alert"`; a 200 clears the three inputs and calls `router.refresh()`.
- [x] 2.2 GREEN: create `src/app/admin/(console)/productos/AddVariantForm.tsx` (`"use client"`) — props `{ productId }`, local `size`/`color`/`sku` input state, `errorMessage`, `submitting`. Renders the `text-outline text-body-sm` note `Empieza en 0. Cargá stock desde Caja.` (design.md UI Shape — the deliberate absence of a stock field). `Agregar` → `fetch(POST)`; on error render `message` in `role="alert"`; on 200 clear inputs + `router.refresh()`.
- [x] 2.3 GREEN: modify `src/app/admin/(console)/productos/ProductRow.tsx` — add one full-width `<tr><td colSpan={6}>` after the `VariantRow` list in the `expanded` branch rendering `<AddVariantForm productId={product.id} />` (G9); nothing else in `ProductRow.tsx` changes.
- [x] 2.4 GREEN: modify `src/app/admin/(console)/productos/ProductRow.test.tsx` — assert `AddVariantForm` mounts only when `expanded` is toggled true, matching the existing `VariantRow` mount assertion.

## Phase 3: Variant-Add E2E (PR 1)

- [x] 3.1 RED→GREEN: create `e2e/admin-productos-avanzado.spec.ts` (mirrors the shipped `e2e/admin-*` pattern) — "owner adds a variant to an existing product": log in, go to `/admin/productos`, expand a seeded product's variant list, submit `AddVariantForm` with a new talle/color/SKU, assert the new variant row appears in the expanded list with no stock column shown.

## Phase 4: Image Service — Add (PR 2)

- [x] 4.1 RED: extend `src/modules/catalog/product.service.test.ts` (same real-Postgres, `randomUUID()`-suffix, `afterAll`-cleanup conventions as `createProduct`) — `addImage` persists `url`/`altText` and assigns `position = max + 1` on a product with existing images, and `0` on one with none; honours an explicit `position`; unknown product id → `ProductNotFoundError`; a product at exactly 5 images → `TooManyImagesError` with `currentCount: 5` **and no row written** (G1/G2); a product at 4 images succeeds.
- [x] 4.2 GREEN: extend `product.service.ts` — `AddImageInput { url; altText?; position? }`, `MAX_PRODUCT_IMAGES = 5`, `TooManyImagesError` (carries `productId`, `currentCount`) → route maps to 409. `addImage(prisma, productId, input)`: ONE read `product.findUnique({ select: { id, images: { select: { position } } } })` (G1) answering existence, the cap, and `max+1` default position; null → `ProductNotFoundError`; `images.length >= 5` → `TooManyImagesError` before any write (G2/G3); `prisma.productImage.create`.

## Phase 5: Image Service — Delete (PR 2)

- [x] 5.1 RED: extend `product.service.test.ts` — `deleteImage` removes the row; succeeds on a product's LAST remaining image, leaving the product valid with zero images (G4); throws `ProductImageNotFoundError` for an unknown image id.
- [x] 5.2 GREEN: extend `product.service.ts` — `ProductImageNotFoundError` (carries `imageId`). `deleteImage(prisma, imageId)`: takes the PK only, no `productId` re-validation (G4); `prisma.productImage.delete({ where: { id: imageId } })`, catch `P2025` → `ProductImageNotFoundError` (E3 verbatim — no non-FK precondition, `P2025` is the whole enforcement).

## Phase 6: Image Routes (PR 2)

- [x] 6.1 RED: create `src/app/api/admin/products/[id]/images/route.test.ts` (same conventions as 1.1) — `POST`: 201 `{id,url,altText,position}`; 400 `invalid_request` for unparseable JSON / empty `url` / a `position` present and not a finite integer >= 0; 401, mutates nothing; 404 `product_not_found`; 409 `too_many_images` with `currentCount` in the body when the product already has 5 images.
- [x] 6.2 GREEN: create `src/app/api/admin/products/[id]/images/route.ts` — `auth()` gate, parse JSON (catch → 400), trim/validate `url`/`altText`/`position` → 400 on failure, `await context.params`, call `addImage`, catch `ProductNotFoundError` → 404 `product_not_found`, `TooManyImagesError` → 409 `too_many_images` with `currentCount`, else rethrow, return 201.
- [x] 6.3 RED: create `src/app/api/admin/products/[id]/images/[imageId]/route.test.ts` — `DELETE`: 200 `{id}`; 200 when it is the product's last image (asserts product row still exists, G4); 401; 404 `image_not_found` for an unknown `imageId`.
- [x] 6.4 GREEN: create `src/app/api/admin/products/[id]/images/[imageId]/route.ts` — `RouteContext { params: Promise<{ id: string; imageId: string }> }`; `id` is not re-validated against `image.productId` (G4). `auth()` gate, `await context.params`, call `deleteImage(prisma, imageId)`, return `{id}` 200, catch `ProductImageNotFoundError` → 404 `image_not_found`, else rethrow.

## Phase 7: Image UI (PR 2)

- [x] 7.1 RED: create `src/app/admin/(console)/productos/ProductImages.test.tsx` (stubbed `fetch`, stubbed `window.confirm`, mocked `useRouter`) — renders one 64px thumbnail per `product.images` entry with `alt={image.altText ?? ""}`; per-image `Eliminar` sends no request when `confirm()` returns false, sends `DELETE .../images/{imageId}` and calls `router.refresh()` on 200 when confirmed; a stubbed non-2xx DELETE renders `message` in `role="alert"`; file input is disabled once `images.length === 5` with `Máximo 5 imágenes.` shown (G2); a failed attach after a successful upload (`POST /api/admin/upload` succeeds, `POST .../images` fails) leaves the file input empty (`key` bump reset) and shows the reset message (G8) — no retry with the already-returned `url`.
- [x] 7.2 GREEN: create `src/app/admin/(console)/productos/ProductImages.tsx` (`"use client"`) — props `{ productId, images }`. Horizontal thumbnail strip (`eslint-disable-next-line @next/next/no-img-element`, mirrors `ProductCard.tsx`); per-image `Eliminar` in `text-red-700` with `confirm()` naming the position; file input calls `POST /api/admin/upload` then `POST .../products/{productId}/images` with the returned `url`; on attach failure, reset the file input via a `key` bump and show the reset message (G8, no URL-reuse retry); disabled at 5 images with `Máximo 5 imágenes.` (G2); `router.refresh()` on any successful attach/delete.
- [x] 7.3 GREEN: modify `src/app/admin/(console)/productos/ProductRow.tsx` — add one full-width `<tr><td colSpan={6}>` after the `AddVariantForm` row in the `expanded` branch rendering `<ProductImages productId={product.id} images={product.images} />` (G9).
- [x] 7.4 GREEN: modify `src/app/admin/(console)/productos/ProductRow.test.tsx` — assert `ProductImages` mounts only when `expanded` is true and the shipped edit/delete flow for the product row itself is unaffected.

## Phase 8: Image E2E (PR 2)

- [x] 8.1 RED→GREEN: extend `e2e/admin-productos-avanzado.spec.ts` — "owner uploads an image and it appears in the storefront gallery": expand a seeded product, upload a file via `ProductImages`, assert the thumbnail appears, then navigate to `/producto/{slug}` and assert the image renders in the storefront gallery.
- [x] 8.2 RED→GREEN: extend the same spec — "owner deletes an image, including the last one": on a product with exactly one image, click `Eliminar`, accept the `confirm()` dialog via `page.on("dialog")`, assert the thumbnail is gone and the product's admin row still renders with zero images.

## Open Items Carried Forward (from design.md)

- Open Question G1: `addImage`'s 5-image cap read-then-write is not atomic under concurrency (two simultaneous attaches could allow a 6th). Accepted per design — single-owner console, no live concurrent-write access pattern. Not design-blocking.
- Open Question G4: `deleteImage` assumes Postgres reports `P2025` for `productImage.delete` on an unknown id. Confirm at task 5.2; if a different code surfaces, widen the catch clause — the route contract (`image_not_found`) is unchanged.
