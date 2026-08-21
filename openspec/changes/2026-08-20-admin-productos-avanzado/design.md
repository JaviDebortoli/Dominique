# Design: Admin Product Variant Add and Image Management

## Technical Approach

Same composition as every shipped slice: archived `dominique-ecommerce` **D1** (rules in `src/modules/*`, routes are thin adapters) and **D7** (`/api/admin/*` sits outside `src/proxy.ts` and checks its own session). No new D-numbers.

Decisions are numbered **G1–G9**. `C`, `D`, `E`, and `F` are all cited by live source comments; `G` is the next free letter.

Two structural notes. First, `addVariant()` is reached but **not modified** — it is already validated and unit-tested, so every caller-side concern (auth, request shape, unknown product, HTTP status) is answered in the new route. Second, archived **E3** ("attempt the delete, let the DB decide") applies *verbatim* to `deleteImage` — unlike F2's stock case, `ProductImage` has no non-FK precondition and no dependents, so `P2025` is the whole enforcement.

## Architecture Decisions

| # | Choice | Rejected alternative | Rationale |
|---|---|---|---|
| G1 | `addImage` performs **one** read — `product.findUnique({ select: { id, images: { select: { position } } } })` — that answers existence (`ProductNotFoundError`), the 5-image cap (`TooManyImagesError`), and the default `position` (`max + 1`) | Three separate queries; or a `_count` + a separate `max` aggregate | F2's precedent: the guard read is not wasted when it also supplies the data the write needs. Cap and position are two facts about the same collection; reading it twice would let them disagree |
| G2 | The 5-image cap lives in `addImage()`, **before** the insert. The gallery also caps at 5 client-side | Enforce in the route; or client-only | D1 — the invariant belongs to the module, so `createProduct`'s images path and any future caller inherit it. The client cap is *feedback*, never enforcement: it disables the picker at 5 so the owner is not made to upload a file that will be rejected, but the server still answers `409` for a stale tab |
| G3 | `TooManyImagesError` → **409** `too_many_images`, not 400 | 400, matching `invalid_request` | F6's rule: the identical request succeeds against a product with 4 images. That is a conflict with the resource's current state (409), not a malformed request (400) |
| G4 | `deleteImage(prisma, imageId)` takes the image PK only; the `[id]` segment is **not** re-validated against `image.productId`. Deleting the last image is freely allowed | `(productId, imageId)` signature with an ownership check; a last-image guard | F8 verbatim — a cuid PK fully identifies the row, and the nested path states ownership to a reader rather than enforcing it. The last-image guard is refused because zero images is already a valid state: `isProductIncomplete()` tolerates it at creation, and the shipped row already renders `Sin imágenes` in red as the standing signal |
| G5 | The variants route **rejects** any `onHand`/`held` key with `400 stock_not_editable`, *and* structurally never constructs an `onHand` property on the input it passes to `addVariant` | Silently coerce a client-supplied `onHand` to `0` | F7 generalized: never report a write that did not happen — silently zeroing a value the client asked for is exactly the lie F7 forbids, and it is untestable as an absence. The rejection is the contract (one route test); omitting the key is the structural belt-and-suspenders, since `addVariant`'s `onHand ?? 0` then guarantees `0` even if validation is later widened |
| G6 | The variants route resolves the product with a PK existence read → `404 product_not_found` before calling `addVariant` | (a) let the FK violation surface as a raw 500; (b) widen `addVariant` to catch `P2003` | (a) is the shape F1 already rejected: a vanished product means a stale tab, which has a real user fix ("recargá la página"), and a 500 gives the owner nothing. (b) re-opens a shipped, unit-tested function with zero production callers for a purely caller-side concern. The read is one indexed PK lookup on a path that already writes |
| G7 | `addImage`'s `url` is accepted as any non-empty trimmed string | Require a `/uploads/products/` prefix | Unchanged trust boundary: `createProduct`'s shipped `images` param accepts the same, fed by the same `POST /api/admin/upload`, which sniffs magic bytes, re-encodes via `sharp`, and names the file itself. Narrowing here alone would diverge two contracts over the same data for no reachable threat behind `auth()` |
| G8 | Upload stays two-step in the client (`POST /api/admin/upload` → `POST .../images`). If the **attach** fails after a successful upload, the gallery clears its file input and returns to the picker | Retry the attach with the already-returned `url` | Resolved owner decision. A URL-reuse retry means holding an orphan URL across renders and adds a second failure mode (re-attaching a URL whose blob may already be duplicated). Cost is one re-upload; orphaned bytes on disk are accepted, no cleanup job |
| G9 | Two new self-contained `"use client"` components — `AddVariantForm` and `ProductImages` — each rendered in its **own** full-width `<tr><td colSpan={6}>` inside `ProductRow`'s existing `expanded` branch, after the `VariantRow` list | (a) one shared `<td>` holding both; (b) fold either into the shipped `PATCH` edit form | Each is an independent mutation with its own endpoint, submitting state, and `role="alert"` — F9 already rejected conflating independently-endpointed mutations into one submit. (a) forces a shared layout and shared error surface on two unrelated actions. `ProductImages` needs no fetch of its own: `listAllProductsForAdmin` already includes `images: { orderBy: { position: "asc" } }`, so `page.tsx` is untouched |

## Non-Goal (restated, binding)

`onHand`/`held` on an **existing** variant stays structurally unwritable everywhere in this change (F7). No new UI renders an input, checkbox, or number field for either; no new route accepts either key for an existing variant; the add-variant route rejects both outright (G5). A **new** variant is created at `onHand: 0` with no stock input on the form. `/admin/caja` + `stock.service.ts` remain the sole stock writers.

## Data Flow

    AddVariantForm (client)      POST .../products/[id]/variants        product.service
      talle/color/SKU  ────────→ auth() ──401                          (addVariant — UNCHANGED)
      (no stock input, G5)       onHand|held key? ──400                → findFirst(productId,size,color)
      fetch POST ───────────────→   stock_not_editable                     → DuplicateVariantError → 409
      router.refresh() ←── 201 ←  empty size|color|sku? ──400          → variant.create({ onHand: 0 })
                                 product missing? ──404 (G6)               catch P2002 → DuplicateVariantError

    ProductImages (client)       POST /api/admin/upload  ──201 { url }  (shipped, unchanged)
      file picker (max 5, G2) ──→ sniff → re-encode → random name
                                 POST .../products/[id]/images         addImage()               (G1)
      fetch POST { url } ───────→ auth() ──401                        → findUnique(id, images.position)
      attach failed? reset                                                null → ProductNotFoundError → 404
      to picker (G8) ←──────────  invalid url? ──400                      images >= 5 → TooManyImagesError → 409
      router.refresh() ←── 201 ←                                       → productImage.create(position: max+1)

      "Eliminar" → confirm()      DELETE .../images/[imageId]           deleteImage()            (G4/E3)
      fetch DELETE ─────────────→ auth() ──401                        → productImage.delete
      router.refresh() ←── 200 ←                                          catch P2025 → ProductImageNotFoundError → 404

## File Changes

| File | Action | Description |
|------|--------|-------------|
| `src/modules/catalog/product.service.ts` | Modify | `addImage`, `deleteImage`, `AddImageInput`, `TooManyImagesError`, `ProductImageNotFoundError`. `addVariant` untouched |
| `src/modules/catalog/product.service.test.ts` | Modify | Extend the existing integration suite |
| `src/app/api/admin/products/[id]/variants/route.ts` | Create | `POST` adapter over `addVariant` (G5/G6) |
| `src/app/api/admin/products/[id]/variants/route.test.ts` | Create | HTTP tests, `makeAuthMockModule()` from `src/lib/testing/admin-auth-mock.ts` |
| `src/app/api/admin/products/[id]/images/route.ts` | Create | `POST` adapter over `addImage` |
| `src/app/api/admin/products/[id]/images/route.test.ts` | Create | HTTP tests |
| `src/app/api/admin/products/[id]/images/[imageId]/route.ts` | Create | `DELETE` adapter over `deleteImage` |
| `src/app/api/admin/products/[id]/images/[imageId]/route.test.ts` | Create | HTTP tests |
| `src/app/admin/(console)/productos/AddVariantForm.tsx` | Create | Client mini-form: talle/color/SKU + `Agregar` |
| `src/app/admin/(console)/productos/ProductImages.tsx` | Create | Client gallery: thumbnails, per-image `Eliminar`, file input |
| `src/app/admin/(console)/productos/AddVariantForm.test.tsx` | Create | Component tests, `fetch` stubbed |
| `src/app/admin/(console)/productos/ProductImages.test.tsx` | Create | Component tests, `fetch`/`window.confirm` stubbed |
| `src/app/admin/(console)/productos/ProductRow.tsx` | Modify | Two new `<tr>`s in the `expanded` branch (G9); nothing else changes |
| `src/app/admin/(console)/productos/ProductRow.test.tsx` | Modify | Assert both sub-components mount only when expanded |
| `e2e/admin-productos-avanzado.spec.ts` | Create | One spec following the shipped `e2e/admin-*` pattern |
| `openspec/specs/admin-console/spec.md` | Modify | Delta applied at archive time |
| `src/app/admin/(console)/productos/page.tsx` | Unchanged | Already fetches `images` ordered by `position` (G9) |
| `src/app/api/admin/upload/route.ts` | Unchanged | Reused verbatim |
| `prisma/schema.prisma` | Unchanged | `product_images_productId_fkey` `ON DELETE CASCADE` already does the work; no migration |

## Interfaces / Contracts

```ts
// src/modules/catalog/product.service.ts
export interface AddImageInput { url: string; altText?: string; position?: number }

/** G2/G3 — hard cap of 5 images per product, checked before the insert. */
export const MAX_PRODUCT_IMAGES = 5;
export class TooManyImagesError extends Error {
  constructor(public readonly productId: string, public readonly currentCount: number)
}
export class ProductImageNotFoundError extends Error {
  constructor(public readonly imageId: string)
}

export function addImage(prisma: PrismaClient, productId: string, input: AddImageInput): Promise<ProductImage>;
export function deleteImage(prisma: PrismaClient, imageId: string): Promise<void>;
```

Every error class sets `this.name` to its own class name and carries an English/technical `message`; the **route** owns all Spanish copy (E4). Error classes are named after the Prisma model (`ProductImageNotFoundError`, matching `ProductNotFoundError`/`VariantNotFoundError`); route error codes are named after the route's own noun (`image_not_found`).

**Routes.** `interface RouteContext { params: Promise<{ id: string }> }` and `{ id: string; imageId: string }`, mirroring the shipped `[id]/route.ts` and `[id]/variants/[variantId]/route.ts`. Every handler calls `auth()` first, then `await context.params`. Anything unmapped rethrows (Next.js 500). Creates answer `201` (matching `POST /api/admin/products`); `DELETE` answers `200 { id }` with a JSON body, matching all four shipped handlers.

`POST /api/admin/products/[id]/variants`:

| Status | Body | When |
|---|---|---|
| 201 | `{ id, sku, size, color }` | Created at `onHand: 0` |
| 400 | `{ error: "invalid_request" }` | Unparseable JSON; `size`, `color`, or `sku` missing or empty after trim |
| 400 | `{ error: "stock_not_editable", message }` | Body carries `onHand` or `held` (G5) |
| 401 | `{ error: "unauthenticated" }` | No `auth()` session |
| 404 | `{ error: "product_not_found" }` | Existence read returned null (G6) |
| 409 | `{ error: "duplicate_variant", message }` | `DuplicateVariantError` — Spanish copy built from `error.size`/`error.color`, not the service's English `message` (E4) |

`POST /api/admin/products/[id]/images`:

| Status | Body | When |
|---|---|---|
| 201 | `{ id, url, altText, position }` | Attached |
| 400 | `{ error: "invalid_request" }` | Unparseable JSON; `url` missing or empty after trim; `position` present and not a finite integer `>= 0` |
| 401 / 404 | `unauthenticated` / `product_not_found` | `ProductNotFoundError` |
| 409 | `{ error: "too_many_images", message, currentCount }` | `TooManyImagesError` (G3) |

`DELETE /api/admin/products/[id]/images/[imageId]`, no body:

| Status | Body | When |
|---|---|---|
| 200 | `{ id }` | Deleted; zero remaining images is allowed (G4) |
| 401 | `{ error: "unauthenticated" }` | — |
| 404 | `{ error: "image_not_found" }` | `ProductImageNotFoundError` |

## UI Shape

No new visual direction — existing Editorial Minimalist tokens only, same restraint as E6/F9. Both components mirror `VariantRow.tsx` exactly: own `fetch`, own `submitting` flag, own `role="alert" text-red-700` message, `router.refresh()` on success, `window.confirm()` before any delete.

**`AddVariantForm`** — one `<tr>`, `<td colSpan={6}>`, indented to `pl-6` like the variant sub-rows so it reads as the last line of the variant list, not a peer of the product. Three inline inputs (`Talle`, `Color`, `SKU`) and an `Agregar` button in `font-sans text-label-caps uppercase tracking-widest`. **There is no stock field** — the deliberate detail is what is missing: a `text-outline text-body-sm` note reading `Empieza en 0. Cargá stock desde Caja.`, which shows F7's rule at the moment the owner would look for the field, rather than explaining it after a rejection. Inputs clear on success.

**`ProductImages`** — one `<tr>`, `<td colSpan={6}>`, a horizontal strip of 64px thumbnails rendered as plain `<img>` with the `eslint-disable-next-line @next/next/no-img-element` comment the shipped `ProductCard.tsx` already uses (local `/uploads` files, not a configured remote domain). Each thumbnail carries `alt={image.altText ?? ""}` and an `Eliminar` control in `text-red-700`; `confirm()` names the position — `¿Eliminar la imagen 2 de "Vestido Lino"? Esta acción no se puede deshacer.` The file input sits at the end of the strip and is disabled at 5 with `Máximo 5 imágenes.` in `text-outline` (G2). Copy names the fix, never just the failure:

- `Máximo 5 imágenes por producto. Eliminá una antes de subir otra.`
- `Subimos la imagen pero no pudimos adjuntarla. Elegí el archivo otra vez.` (G8 — the input is reset with a `key` bump, so the picker is genuinely empty)
- `Ya existe una variante talle "M" color "Negro". Editá la existente.`

## Testing Strategy

| Layer | What to Test | Approach |
|-------|-------------|----------|
| Integration (service) | `addImage` persists `url`/`altText` and assigns `position = max + 1` on a product that already has images, and `0` on one with none; honours an explicit `position`; unknown product → `ProductNotFoundError`; a product at exactly 5 images → `TooManyImagesError` with `currentCount: 5` **and no row written**; a product at 4 succeeds. `deleteImage` removes the row, succeeds on the product's **last** image and leaves the product valid, and throws `ProductImageNotFoundError` for an unknown id | Real Postgres, `randomUUID()` slug/SKU suffixes, `afterAll` id cleanup — mirrors the shipped `createProduct`/`addVariant` suites |
| Integration (route) | Variants `POST`: 201 with `onHand: 0` **persisted as 0**, 400 `stock_not_editable` for an `onHand` key and for a `held` key (G5), 400 `invalid_request` (empty `sku`), 404 `product_not_found` (G6), 409 `duplicate_variant`, 401 mutates nothing. Images `POST`: 201 shape, 400 empty `url`, 404, 409 `too_many_images` with `currentCount`, 401. Images `DELETE`: 200 `{ id }`, 200 on the last image, 404 `image_not_found`, 401 | `vi.mock("@/lib/auth", () => makeAuthMockModule())` + real Postgres — mirrors `api/admin/products/[id]/variants/[variantId]/route.test.ts` |
| Component | `AddVariantForm` POSTs exactly `{ size, color, sku }` and **never** an `onHand` or `held` key; renders the server `message` in `role="alert"`; clears on success and calls `router.refresh()`. `ProductImages` renders one thumbnail per image; `Eliminar` sends no request when `confirm()` returns false; a failed attach after a successful upload leaves the file input empty and shows the reset message (G8); the file input is disabled at 5 images. `ProductRow` mounts neither sub-component until the `Variantes` cell is clicked, and the shipped edit/delete flow is unaffected | `@testing-library/react` + `user-event`, `fetch`/`window.confirm` stubbed — mirrors `VariantRow.test.tsx` |
| E2E | Owner adds a variant to an existing product and it appears in the expanded list with no stock column; owner uploads an image and it appears in the storefront gallery; owner deletes it and the product page still renders | One spec following the existing `e2e/admin-*` pattern |

## Threat Matrix

N/A — every row in `references/threat-matrix.md` covers a VCS/shell/subprocess/PR-automation or executable-file-classification boundary. This change adds three HTTP routes inside the existing Next.js App Router, gated by the same `auth()` call as every shipped `/api/admin/*` route, and touches no shell, subprocess, or git invocation. The executable-file-classification row belongs to `POST /api/admin/upload`, which is **reused verbatim and not modified** — its magic-byte sniff, `sharp` re-encode, and server-generated filename already shipped with their tests. The adversarial cases that do exist here — unauthenticated `POST`/`DELETE`, an `onHand` smuggled into the add-variant body, a 6th image, a foreign `imageId` — are route-contract cases and are required tests above.

## Migration / Rollout

No migration required. Purely additive: no schema change, no change to `createProduct`, `addVariant`, `updateProduct`, `deleteProduct`, the shipped `PATCH` form, `NewProductForm`, or any read path. Rollback is reverting the PR — three routes, two service functions, and two UI components disappear. Variants and images added meanwhile remain valid rows.

## Open Questions

- [ ] G1 assumes `productImage.create` cannot violate the cap under concurrency (two attaches passing the count read simultaneously would allow a 6th). Accepted for the same reason as E2 and F5: a single-owner console where concurrent writes to one product are not a real access pattern. No DB constraint can express "at most 5 rows per FK", so closing it would need a `$transaction` with a serializable isolation level — disproportionate. Not design-blocking.
- [ ] G4 assumes `productImage.delete` on an unknown id reports `P2025`. Confirm at implementation time; if Prisma surfaces a different code, the catch clause widens and the route contract is untouched.
