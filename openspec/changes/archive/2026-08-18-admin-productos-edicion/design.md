# Design: Admin Product and Variant Edit and Delete

## Technical Approach

Same composition as every shipped slice: archived `dominique-ecommerce` **D1** (rules in `src/modules/*`, routes are thin adapters) and **D7** (`/api/admin/*` sits outside `src/proxy.ts` and checks its own session). No new D-numbers.

Decisions are numbered **F1–F9**. `C` (admin-categorias), `D` (dominique-ecommerce), and `E` (admin-categorias-edicion) are all cited by live source comments; continuing `E7+` here would make `category.service.ts`'s existing `design.md E1`/`E3` markers ambiguous about which document they point to. `F` is the next free letter.

One structural departure from the categories slice, forced by the data: **E3's "attempt the delete, let the DB decide" rule is not sufficient here.** `P2003` reports only *that* a foreign key blocked the statement, and `onHand > 0` is not a foreign key at all — `createProduct` writes initial stock directly with no `StockMovement` row, so `RESTRICT` cannot see it. The proposal requires *cause-specific* messages (history vs. stock vs. last-variant). A pre-check is therefore structurally required, not a preference. E3 is preserved where it still applies: history remains DB-adjudicated via `P2003`.

## Architecture Decisions

| # | Choice | Rejected alternative | Rationale |
|---|---|---|---|
| F1 | `updateProduct` catches `P2003` on the `update` and throws `ProductCategoryNotFoundError` → route `400 invalid_category` | (a) let the FK violation surface as a raw 500; (b) pre-check `category.findUnique` before updating | A bad `categoryId` is not a server fault — the picker is seeded from the DB, so it means a stale tab (the category was deleted elsewhere), which has a real user fix ("recargá la página"). (a) gives the owner nothing to act on. (b) pays a round-trip on every happy-path edit and still needs the catch, since the category can vanish between read and write. Identical shape to E3: the DB is the authority, the catch only explains |
| F2 | `deleteProduct` reads the product's variants (`id, sku, onHand`) first, blocks on any `onHand > 0`, then attempts `product.delete` and catches `P2003` for history | Pure attempt-and-catch (E3 verbatim) | `onHand > 0` is not expressible as a constraint (see Technical Approach), so no catch clause can ever fire for it — the read is the only enforcement available, exactly as E2 argued for `name`. The read is not wasted: it supplies the SKUs F3 needs |
| F3 | Stock-blocked names the offending SKUs; history-blocked reports product-level counts only | Name the blocking variant in both cases | The remedies differ. Stock is fixable per variant — the owner takes those exact SKUs to `/admin/caja` and adjusts them to 0, so naming them is the instruction. History is not fixable at all, and naming one SKU out of several would imply that deleting that variant unblocks the product, which is false when others also have history. `orderItemCount` + `stockMovementCount` are honest about the blocker's size and cost two `count` queries on the already-failed path only |
| F4 | `deleteVariant` order: last-variant `count` → `onHand > 0` → `delete` + `P2003` catch. **No** interactive `$transaction` | (a) stock before last-variant; (b) wrap the checks and the delete in `$transaction` | (a) would tell the owner "adjust stock to 0 first" and then block them again on last-variant — a two-step lie. Last-variant is unconditional and its remedy is different in kind ("delete the product instead"), so it answers first. (b) closes no window that matters: **every** writer that can raise `onHand` after creation (`adjust`, `sellInStore`, `commitPaid`, `hold`, `release` — verified in `stock.service.ts`) also writes a `StockMovement`, and that row's `ON DELETE RESTRICT` blocks the delete independently. The `onHand > 0`-with-no-movement state can only be *left*, never entered, so the pre-check has no live TOCTOU residue |
| F5 | `updateVariant` pre-checks the resolved `size`+`color` pair with `findFirst({ productId, size, color, NOT: { id } })` → reuses the shipped `DuplicateVariantError`; `sku` collisions come from catching `P2002` on the update → `DuplicateSkuError` | (a) pre-check both; (b) catch `P2002` for both and branch on `error.meta.target` | The pair must be *resolved* (patch merged over current values) because a request changing only `color` still moves the pair, and the variant is already read for F6's history gate — so the `findFirst` is free and mirrors `addVariant` exactly. `sku` has a real `@unique`, so C2 applies: a pre-check would be a redundant round-trip. Ordering the pair check first makes a surviving `P2002` unambiguously the `sku` without depending on `meta.target`'s shape (see Open Questions) |
| F6 | `size`/`color` on a variant with `OrderItem` rows → `409 variant_attributes_immutable` | `400`, matching E5's `slug_immutable` | E5 is `400` because `slug` is *never* writable — that request is malformed against every possible server state, which is what `400` means. `size`/`color` **are** writable fields; the same request succeeds against a variant with no history. The rejection is a conflict with the resource's current state, which is `409`, and it matches the shipped `category_has_products` — the other "blocked by existing data" answer |
| F7 | An `onHand` or `held` key in the variant `PATCH` body → `400 stock_not_editable`, message naming `/admin/caja` | Silently ignore keys the service cannot write | E5's rule generalized: never report a write that did not happen. This is also the concrete enforcement of the proposal's "no edit surface exposes `onHand`" criterion — a testable route contract rather than an absence |
| F8 | The variant route's `[id]` segment is **not** re-validated against `variant.productId` | 404 when the variant does not belong to the product in the path | `variantId` is a cuid PK and fully identifies the row, so the parent check buys nothing but an extra read in the route (breaking D1's thin-adapter rule) or a signature the proposal already fixed as `updateVariant(prisma, variantId, …)`. The mismatch is unreachable from the UI, which builds both segments from one rendered row. The nested path stays because it states ownership to a reader |
| F9 | `ProductRow.tsx` (client) owns the product `<tr>`; the `Variantes` count is the disclosure control that reveals `VariantRow.tsx` sub-rows. Product edit replaces the row with a full-width `<td colSpan={6}>` form row | (a) modal dialog; (b) a dedicated `/admin/productos/[id]/editar` route reusing `NewProductForm`; (c) always-expanded variant sub-rows | Product edit has four fields, so E6's single-input-cell shape does not carry — but a form row does, with zero new primitives. (a) needs a focus trap, escape handling, and a backdrop. (b) needs a second data fetch for data `listAllProductsForAdmin` already returns, and `NewProductForm` also collects `slug`, variants, and images — none of which this change edits — so reuse means forking it. (c) renders 60+ undifferentiated rows for a 20-product catalog |

## Data Flow

    ProductRow (client)          PATCH /api/admin/products/[id]        product.service
      "Editar" → form row         auth() ──401                          updateProduct()
      fetch PATCH {name,          slug key? ──400 slug_immutable      → prisma.product.update
        description, price, ────→ no writable key? ──400                 catch P2025 → ProductNotFoundError → 404
        categoryId}               invalid_request                        catch P2003 → ProductCategoryNotFoundError → 400
      router.refresh() ←── 200 ←────────────────────────────────────────────────────────────────────

      "Eliminar" → confirm()      DELETE /api/admin/products/[id]       deleteProduct()          (F2/F3)
      fetch DELETE ─────────────→ auth() ──401                        → findUnique(variants: id, sku, onHand)
                                                                          null → 404
                                                                          any onHand>0 → ProductHasStockError(skus) → 409
                                                                        → prisma.product.delete   (cascades Variants+Images)
                                                                          catch P2003 → count OrderItem + StockMovement
                                                                            → ProductHasHistoryError → 409

    VariantRow (client)          PATCH .../[id]/variants/[variantId]   updateVariant()          (F5/F6/F7)
      fetch PATCH {sku,           auth() ──401                        → findUnique(variant) → 404
        size?, color?} ─────────→ onHand/held key? ──400                 size|color present + OrderItem rows?
                                    stock_not_editable                     → VariantAttributesImmutableError → 409
                                                                        → findFirst(resolved pair, NOT self)
                                                                            → DuplicateVariantError → 409
                                                                        → prisma.variant.update
                                                                            catch P2002 → DuplicateSkuError → 409

      "Eliminar" → confirm()      DELETE .../variants/[variantId]       deleteVariant()          (F4)
      fetch DELETE ─────────────→ auth() ──401                        → variant.count({productId}) === 1
                                                                            → LastVariantError → 409
                                                                        → onHand > 0 → VariantHasStockError → 409
                                                                        → prisma.variant.delete
                                                                            catch P2003 → counts → VariantHasHistoryError → 409

## File Changes

| File | Action | Description |
|------|--------|-------------|
| `src/modules/catalog/product.service.ts` | Modify | 10 typed errors, `UpdateProductInput`/`UpdateVariantInput`, `updateProduct`, `deleteProduct`, `updateVariant`, `deleteVariant` |
| `src/modules/catalog/product.service.test.ts` | Modify | Extend the existing integration suite |
| `src/app/api/admin/products/[id]/route.ts` | Create | Product `PATCH` + `DELETE` adapter |
| `src/app/api/admin/products/[id]/route.test.ts` | Create | HTTP tests, `makeAuthMockModule()` from `src/lib/testing/admin-auth-mock.ts` |
| `src/app/api/admin/products/[id]/variants/[variantId]/route.ts` | Create | Variant `PATCH` + `DELETE` adapter |
| `src/app/api/admin/products/[id]/variants/[variantId]/route.test.ts` | Create | HTTP tests |
| `src/app/admin/(console)/productos/ProductRow.tsx` | Create | Client `<tr>`: view/edit/expanded modes, delete `confirm()`, `router.refresh()` |
| `src/app/admin/(console)/productos/VariantRow.tsx` | Create | Client variant sub-`<tr>`: inline `sku`/`size`/`color` edit + delete |
| `src/app/admin/(console)/productos/ProductRow.test.tsx` | Create | Component tests, `fetch`/`window.confirm` stubbed |
| `src/app/admin/(console)/productos/VariantRow.test.tsx` | Create | Component tests |
| `src/app/admin/(console)/productos/page.tsx` | Modify | Sixth `Acciones` header; also fetches categories for the edit picker (mirrors `productos/nuevo/page.tsx:12`); `<tbody>` maps to `<ProductRow>`; `colSpan={5}` → `6` |
| `e2e/admin-productos-edicion.spec.ts` | Create | One spec following the shipped `e2e/admin-*` pattern |
| `openspec/specs/admin-console/spec.md` | Modify | Delta applied at archive time |
| `prisma/schema.prisma` | Unchanged | `ON DELETE RESTRICT` on `order_items_variantId_fkey`/`stock_movements_variantId_fkey` and `ON DELETE CASCADE` on `variants_productId_fkey`/`product_images_productId_fkey` already do the work |

## Interfaces / Contracts

```ts
// src/modules/catalog/product.service.ts — no `slug`, `onHand`, `held`, or
// `priceOverride` field on either input: structurally unwritable (F7).
export interface UpdateProductInput {
  name?: string; description?: string | null; price?: number; categoryId?: string;
}
export interface UpdateVariantInput { sku?: string; size?: string; color?: string }

export class ProductNotFoundError extends Error { constructor(public readonly productId: string) }
export class VariantNotFoundError extends Error { constructor(public readonly variantId: string) }
/** F1 — `categoryId` in the payload no longer resolves. */
export class ProductCategoryNotFoundError extends Error { constructor(public readonly categoryId: string) }
/** F2/F3 — carries the SKUs the owner must zero out in /admin/caja. */
export class ProductHasStockError extends Error {
  constructor(public readonly productId: string, public readonly skus: string[])
}
export class ProductHasHistoryError extends Error {
  constructor(public readonly productId: string,
              public readonly orderItemCount: number,
              public readonly stockMovementCount: number)
}
export class VariantHasStockError extends Error {
  constructor(public readonly variantId: string, public readonly sku: string, public readonly onHand: number)
}
export class VariantHasHistoryError extends Error {
  constructor(public readonly variantId: string,
              public readonly orderItemCount: number,
              public readonly stockMovementCount: number)
}
export class LastVariantError extends Error {
  constructor(public readonly productId: string, public readonly variantId: string)
}
export class DuplicateSkuError extends Error { constructor(public readonly sku: string) }
/** F6 — size/color frozen once the variant appears on an order. */
export class VariantAttributesImmutableError extends Error {
  constructor(public readonly variantId: string, public readonly orderItemCount: number)
}

export function updateProduct(prisma: PrismaClient, id: string, input: UpdateProductInput): Promise<Product>;
export function deleteProduct(prisma: PrismaClient, id: string): Promise<void>;
export function updateVariant(prisma: PrismaClient, variantId: string, input: UpdateVariantInput): Promise<Variant>;
export function deleteVariant(prisma: PrismaClient, variantId: string): Promise<void>;
```

Every error class sets `this.name` to its own class name and carries an English/technical `message`; the **route** owns all Spanish copy, exactly as `api/admin/categories/[id]/route.ts` does (E4).

**Routes.** `interface RouteContext { params: Promise<{ id: string }> }` and `{ id: string; variantId: string }` respectively, mirroring `api/admin/orders/[orderId]/pickup/route.ts`. Every handler calls `auth()` first, then `await context.params`. Anything unmapped rethrows (Next.js 500), as the create route does. `DELETE` answers `200 { id }` with a JSON body, not `204` — every shipped handler in `src/app/api/**` returns a body, and uniformity keeps the client's `response.json()` handling identical across all four calls.

`PATCH /api/admin/products/[id]` — strings trimmed before validation:

| Status | Body | When |
|---|---|---|
| 200 | `{ id, name, slug, description, price, categoryId }` | Updated |
| 400 | `{ error: "invalid_request" }` | Unparseable JSON; no writable key present; `name` empty after trim; `price` not a finite number `>= 0`; `description` neither `string` nor `null`; `categoryId` empty |
| 400 | `{ error: "slug_immutable", message }` | Body carries a `slug` key at all (E5) |
| 400 | `{ error: "invalid_category", message }` | `ProductCategoryNotFoundError` (F1) |
| 401 | `{ error: "unauthenticated" }` | No `auth()` session |
| 404 | `{ error: "product_not_found" }` | `ProductNotFoundError` |

`DELETE /api/admin/products/[id]`, no body:

| Status | Body | When |
|---|---|---|
| 200 | `{ id }` | Deleted (variants + images cascaded) |
| 401 / 404 | as above | — |
| 409 | `{ error: "product_has_stock", message, skus }` | `ProductHasStockError` (F3) |
| 409 | `{ error: "product_has_history", message, orderItemCount, stockMovementCount }` | `ProductHasHistoryError` |

`PATCH /api/admin/products/[id]/variants/[variantId]`:

| Status | Body | When |
|---|---|---|
| 200 | `{ id, sku, size, color }` | Updated |
| 400 | `{ error: "invalid_request" }` | Unparseable JSON; no writable key; any provided value empty after trim |
| 400 | `{ error: "stock_not_editable", message }` | Body carries `onHand` or `held` (F7) |
| 401 / 404 | `unauthenticated` / `variant_not_found` | — |
| 409 | `{ error: "duplicate_sku", message }` | `DuplicateSkuError` |
| 409 | `{ error: "duplicate_variant", message }` | `DuplicateVariantError` (resolved pair collides) |
| 409 | `{ error: "variant_attributes_immutable", message, orderItemCount }` | `VariantAttributesImmutableError` (F6) |

`DELETE /api/admin/products/[id]/variants/[variantId]`:

| Status | Body | When |
|---|---|---|
| 200 | `{ id }` | Deleted |
| 401 / 404 | as above | — |
| 409 | `{ error: "last_variant", message }` | `LastVariantError` (F4) |
| 409 | `{ error: "variant_has_stock", message, onHand }` | `VariantHasStockError` |
| 409 | `{ error: "variant_has_history", message, orderItemCount, stockMovementCount }` | `VariantHasHistoryError` |

## UI Shape

No new visual direction — existing Editorial Minimalist tokens only, same restraint as E6. `page.tsx` gains an `Acciones` column and passes `categories` down (fetched exactly as `productos/nuevo/page.tsx:12` does).

**Product row, view mode**: unchanged cells, plus `Editar` / `Eliminar` as `font-sans text-label-caps uppercase tracking-widest` text buttons (`text-ink` / `text-red-700`). **Edit mode**: the row's cells are replaced by one `<td colSpan={6}>` holding a compact grid — name input, price input, category `<select>`, description `<textarea>` — with `Guardar` / `Cancelar`. `Escape` cancels.

The deliberate detail, carried over from `NewCategoryForm`'s slug preview and E6's uneditable slug cell: the edit row renders `/producto/{slug}` in `text-outline` above the fields, unchanged and uneditable, so the owner sees at the moment of renaming that the public URL is not following the label — the exact confusion slug-immutability creates, shown rather than explained.

**Variant disclosure**: the `Variantes` count cell is the control. Clicking it toggles `VariantRow` sub-rows, indented, no top border, SKU in `text-outline text-body-sm` — the eye reads them as annotations of the product line, not as peers. Variant edit stays E6-shaped (three inline inputs, one cell each) because the fields are single-line. No modal, no animation, no new token.

Delete is **always clickable, never pre-disabled** (resolved refinement): `confirm()` names the target — `¿Eliminar "Vestido Lino"? Esta acción no se puede deshacer.` — and the cause-specific message appears only after the request comes back rejected, in the actions cell as `role="alert" text-red-700`, mirroring `NewCategoryForm`. Copy names the fix, never just the failure:

- `No se puede eliminar: tiene 3 venta(s) y 12 movimiento(s) de stock registrados. Editalo en lugar de borrarlo, o dejá de reponerlo.`
- `No se puede eliminar: todavía hay unidades en stock (VES-M-NEGRO). Ajustá el stock a 0 desde Caja y volvé a intentar.`
- `No se puede eliminar la última variante. Eliminá el producto entero si ya no lo vendés.`

Both handlers call `router.refresh()` on success.

## Testing Strategy

Ten requirement areas, mapped to the layer that owns each.

| Layer | What to Test | Approach |
|-------|-------------|----------|
| Integration (service) | **(1)** `updateProduct` persists `name`/`description`/`price`/`categoryId` and leaves `slug` byte-identical; unknown id → `ProductNotFoundError`; unknown `categoryId` → `ProductCategoryNotFoundError` (F1). **(3)** `deleteProduct` throws `ProductHasHistoryError` with exact counts and deletes nothing when a variant has an `OrderItem`; succeeds on a clean product and cascades its variants + images away. **(4)** throws `ProductHasStockError` naming the SKU for a variant with `onHand > 0` **and no `StockMovement` row** (the case `RESTRICT` cannot see — F2). **(5)** `deleteVariant` throws `LastVariantError` when one variant remains, even if that variant is clean; `VariantHasStockError`; `VariantHasHistoryError`; succeeds on a clean non-last variant. **(6)** `updateVariant` changes `sku`, rejects a duplicate `sku` with `DuplicateSkuError`, and rejects a `color` change that collides with a sibling's resolved pair (F5). **(7)** rejects `size`/`color` with `VariantAttributesImmutableError` once an `OrderItem` exists, while `sku` on the same variant still succeeds. **(10)** no returned shape carries `onHand`/`held` outside the internal guard reads | Real Postgres, `randomUUID()` SKU/slug suffixes, `afterAll` id cleanup — mirrors the shipped `createProduct`/`addVariant` suites in `product.service.test.ts` |
| Integration (route) | Product `PATCH`: 200 shape, **(2)** 400 `slug_immutable`, 400 `invalid_request` (no writable key, negative price), 400 `invalid_category`, **(8)** 401 mutates nothing, **(9)** 404. Product `DELETE`: 200 `{ id }`, 409 `product_has_stock` with `skus`, 409 `product_has_history` with both counts, 401, 404. Variant `PATCH`: 200, 400 `stock_not_editable` for an `onHand` key (F7), 409 `duplicate_sku`, 409 `variant_attributes_immutable`, 401, 404. Variant `DELETE`: 200, 409 `last_variant`, 409 `variant_has_stock`, 409 `variant_has_history`, 401, 404 | `vi.mock("@/lib/auth", () => makeAuthMockModule())` + real Postgres — mirrors `api/admin/categories/[id]/route.test.ts` |
| Component | `Editar` swaps the row for the form row seeded with current values; `Cancelar`/`Escape` restores without a fetch; `Guardar` PATCHes only writable keys and **never** a `slug`, `onHand`, or `held` key; the `Variantes` cell toggles variant sub-rows; server `message` renders in `role="alert"`; `Eliminar` sends no request when `confirm()` returns false and DELETEs when true; the delete button is enabled even for a product the fixture marks as having history (no client-side precomputation) | `@testing-library/react` + `user-event`, `fetch` and `window.confirm` stubbed — mirrors `CategoryRow.test.tsx` |
| E2E | Owner corrects a mistyped price and a wrong category from `/admin/productos` and both appear on the storefront product page with the URL unchanged; deleting a product that has an order shows the history message and removes nothing | One spec following the existing `e2e/admin-*` pattern |

## Threat Matrix

N/A — every row in `references/threat-matrix.md` covers a VCS/shell/subprocess/PR-automation or executable-file-classification boundary. This change adds two HTTP routes inside the existing Next.js App Router, gated by the same `auth()` call as every shipped `/api/admin/*` route, and touches no shell, subprocess, git invocation, or file classification. The adversarial cases that do exist — unauthenticated `PATCH`/`DELETE`, a `slug` smuggled into the body, an `onHand` smuggled into the variant body, delete of a product with history or stock — are route-contract cases and are required tests above.

## Migration / Rollout

No migration required. Purely additive: no schema change, no change to `createProduct`, `addVariant`, or any read path. Rollback is reverting the PR — both `[id]` routes, `ProductRow`, `VariantRow`, and the four service functions disappear. Applied edits stay valid rows; deleted records could only ever have been ones with no history and no stock.

## Open Questions

- [ ] F5 assumes a `P2002` surviving the resolved-pair pre-check is always the `sku` constraint. The residual case is a concurrent `addVariant` claiming the pair between check and write, which would surface as `DuplicateSkuError` — accepted for the same reason as E2 (single-owner console, concurrent variant writes are not a real access pattern). If a cheap discriminator is wanted at implementation time, inspect `error.meta.target` and branch; the design's contract is unchanged either way. Not design-blocking.
- [ ] F2's stock pre-check reads `variants` with `select: { id, sku, onHand }`. Confirm at implementation time that `product.delete` on Postgres reports `P2003` (not `P2025`) when a *cascaded* variant delete is refused by `order_items_variantId_fkey`; if Prisma surfaces a different code for cascade-path violations, the catch clause widens to match, and F3's counting logic is untouched.
