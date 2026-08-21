# Proposal: Admin Product Variant and Image Management

## Intent

`/admin/productos` can edit a product's core fields and can edit or delete existing variants, but it cannot **add** a variant, and cannot touch images at all after creation. `addVariant()` (`product.service.ts:237-273`) is already written, validated, and unit-tested with zero callers — a pure wiring gap. Images are worse: no service function, route, or UI exists, so a wrong or missing photo is unfixable without direct DB access. Closes bugs.md items 2 and 6.

## Scope

### In Scope

- `POST /api/admin/products/[id]/variants` wrapping the existing `addVariant()` — no service change; new variant always starts at `onHand: 0` (form does not accept stock)
- `addImage(prisma, productId, {url, altText?, position?})` + `deleteImage(prisma, imageId)`, typed errors matching `product.service.ts` convention, including a new `TooManyImagesError` (max 5 images per product)
- `POST /api/admin/products/[id]/images` and `DELETE /api/admin/products/[id]/images/[imageId]`
- "Agregar variante" mini-form and an image gallery with per-image delete + file input, both inside `ProductRow`'s already-expanded variants region
- `admin-console` spec delta

### Out of Scope

- bugs.md point 3 (delete product without stock) — exploration proved `deleteProduct()` already works correctly; no functional change
- `onHand`/`held` on an existing variant — `/admin/caja` + `stock.service.ts` stay sole owners
- Any change to `POST /api/admin/upload` — reused verbatim
- Image reorder, cover selection, altText editing, bulk upload
- The shipped 4-field PATCH form and `NewProductForm.tsx` — both untouched

## Capabilities

### New Capabilities

- None

### Modified Capabilities

- `admin-console`: "Product and Variant Management" gains add-variant (including duplicate size+color rejection), add-image, and delete-image

## Approach

Exploration approach 2: self-contained sub-components inside the existing variants disclosure, mirroring `VariantRow.tsx` (own fetch, `confirm()`, error state, `router.refresh()`). Each mutation keeps its own thin route and typed error, like every prior slice. Upload stays two-step — the browser POSTs the file to the existing `/api/admin/upload`, then POSTs the returned `url` to the new images route. Same trust boundary `createProduct` already accepts, since upload re-encodes and sniffs.

## Affected Areas

| Area | Impact | Description |
|------|--------|-------------|
| `src/modules/catalog/product.service.ts` | Modified | `addImage` + `deleteImage` + typed errors; `addVariant` unchanged |
| `src/app/api/admin/products/[id]/variants/route.ts` | New | POST add-variant |
| `src/app/api/admin/products/[id]/images/route.ts` | New | POST attach-image |
| `src/app/api/admin/products/[id]/images/[imageId]/route.ts` | New | DELETE image |
| `src/app/admin/(console)/productos/ProductRow.tsx` | Modified | Mounts the two new sub-components |
| `src/app/admin/(console)/productos/` | New | `AddVariantForm` + `ProductImages` client components |
| `src/app/api/admin/upload/route.ts` | Unchanged | Reused as-is |
| `prisma/schema.prisma` | Unchanged | No migration |

## Risks

| Risk | Likelihood | Mitigation |
|------|------------|------------|
| Two largely independent slices in one `single-pr` delivery push past the 800-line budget | Med | `sdd-tasks` forecasts; split into variant slice then image slice if it exceeds |
| Orphaned uploaded file when upload succeeds but attach fails | Med | Surface the failure and reset to the file picker (no URL-reuse retry); accept orphan bytes on disk — no rollback of the upload |
| New UI inside the variants region regresses the shipped edit/delete flow | Low | Sub-components are self-contained; PATCH form and `VariantRow` untouched |
| Client-supplied `url` on `addImage` | Low | Same boundary as `createProduct`'s `images`; `/api/admin/upload` already re-encodes and sniffs |

## Rollback Plan

Additive only — no migration, no change to create, read, or the shipped PATCH flow. Revert the PR: three routes, two service functions, and the two UI sub-components disappear. Variants and images added meanwhile remain valid rows.

## Dependencies

- None. Uses shipped auth, Prisma client, `/api/admin/upload`, and Editorial Minimalist tokens.

## Success Criteria

- [ ] Owner adds a variant to an existing product from `/admin/productos` with no DB access
- [ ] Adding a variant whose size+color already exists is rejected with a readable message
- [ ] Owner uploads a new image onto an existing product and it appears in the storefront gallery
- [ ] Owner deletes any image, including the last one, and the product stays valid
- [ ] Attempting to add a 6th image to a product that already has 5 is rejected with a readable message
- [ ] A new variant is created with `onHand: 0`; the form exposes no stock input
- [ ] No surface exposes or edits an existing variant's `onHand` or `held`
- [ ] Unauthenticated POST/DELETE on the new routes return JSON `401` and mutate nothing

## Open Decisions — RESOLVED (owner, before spec/design)

- **Last remaining image**: deleting it is freely allowed. Zero images is already a valid state at creation (`isProductIncomplete()` tolerates it); no last-image guard.
- **Add variant with existing history**: no extra guard. `addVariant()`'s duplicate size+color check is sufficient — adding never rewrites existing variants or order history.
- **New variant's `onHand`**: RESOLVED — always `0`, no stock input on the add-variant form. `/admin/caja` stays the sole stock entry point; stricter than "set-at-creation," fully consistent with archived design F7.
- **Upload failure semantics**: RESOLVED — if attaching an already-uploaded image to the product fails, the UI resets to the file picker (no URL-reuse retry). Simpler at the cost of a full re-upload on retry; orphaned bytes on disk are accepted (no cleanup job, out of scope).
- **Image count cap**: RESOLVED — maximum 5 images per product, enforced by `addImage()` via a new `TooManyImagesError`. A 6th upload attempt is rejected with a readable message before any file write beyond the already-uploaded blob.
- **bugs.md point 3**: out of scope, refuted as a backend defect. `deleteProduct()` never calls `deleteVariant()`, so `LastVariantError` is unreachable from product delete.
