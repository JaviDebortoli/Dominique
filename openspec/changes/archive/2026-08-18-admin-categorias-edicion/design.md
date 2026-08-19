# Design: Admin Category Edit and Delete

## Technical Approach

Same composition as the shipped creation slice: archived `dominique-ecommerce` **D1** (rules in `src/modules/*`, routes are thin adapters) and **D7** (`/api/admin/*` sits outside `src/proxy.ts` and checks its own session). No new D-numbers.

Decisions are numbered **E1–E6**, not `C6+`: `category.service.ts` and `categorias/page.tsx` already cite `design.md C1/C2/C3` from the archived `2026-08-16-admin-categorias` design, so reusing the `C` sequence would make those existing comments ambiguous about which document they point to.

Three layers, each extending a shipped file: two service functions plus two typed errors in `category.service.ts`, one new `[id]/route.ts` adapter (first non-POST handler in `src/app/api/**`), and one client `<tr>` component the RSC page maps over.

## Architecture Decisions

| # | Choice | Rejected alternative | Rationale |
|---|---|---|---|
| E1 | `renameCategory` pre-checks with `findFirst({ where: { name: { equals, mode: "insensitive" }, NOT: { id } } })` → `DuplicateCategoryNameError` | (a) `@@unique([name])`; (b) a `lower(name)` functional unique index in hand-written migration SQL | The proposal's Out of Scope forbids schema migration. Also, a plain `@@unique` is **case-sensitive** in Postgres and would not satisfy the resolved case-insensitive rule at all; (b) would, but needs raw SQL in a migration this change is not authorized to write. Application-level is the only in-scope enforcement. `NOT: { id }` is required so a case-only self-fix ("Bijou" → "bijou") is allowed |
| E2 | The E1 pre-check does **not** contradict C2's "no pre-check" rule | Treat C2 as a blanket ban | C2 rejected a pre-check *because `slug @unique` already existed* and made it a redundant round-trip. For `name` there is no constraint, so no catch clause can ever fire — a read is the only enforcement available. Its TOCTOU window is accepted: the console has a single owner, concurrent renames are not a real access pattern, and the failure mode is a duplicate display label, which the proposal already documented as tolerable |
| E3 | `deleteCategory` attempts `delete`, catches `P2003`, **then** counts products for the message | (a) `_count` pre-check before deleting; (b) interactive `$transaction` | The DB constraint stays the single authority for *whether* the delete is blocked — C2 is preserved exactly. (a) pays a round-trip on the happy path and still needs the `P2003` catch, since a product can be inserted after a zero count. The count here is not a gate, it runs only on the already-failed path and cannot change the outcome, so C2's TOCTOU concern has no analogue: worst case the copy says 12 while it is now 11, and the delete is still correctly refused |
| E4 | Typed errors carry the count as a field; the **route** owns the Spanish copy | Put the user-facing Spanish string in the service | Follows the shipped split: `DuplicateCategorySlugError`'s own message is English/technical and `route.ts` maps it to "Ya existe una categoría con esta URL." `CategoryHasProductsError` carries `productCount` so the route can render "tiene 12 productos asignados" with correct singular/plural |
| E5 | `PATCH` **rejects** a body containing a `slug` key with `400 slug_immutable` | Silently strip/ignore `slug` | Both keep `slug` out of the database, but a silent strip tells the caller a write happened that did not. An explicit code is testable and states what went wrong |
| E6 | Inline row edit: one `"use client"` `CategoryRow.tsx` renders the whole `<tr>` | (a) a modal dialog; (b) a `CategoryRowActions` cell-only component | (a) needs focus trap, escape handling, and a backdrop — new primitives, for one text field. (b) cannot reach the name cell, which would force the rename back into (a) or a separate route. A component owning the full row keeps `page.tsx` an RSC and reuses only tokens already on the page |

## Data Flow

    CategoryRow (client)         PATCH /api/admin/categories/[id]      category.service
      "Editar" → input            auth() ──401                          renameCategory()
      fetch PATCH {name} ───────→ slug key? ──400 slug_immutable      → findFirst insensitive
                                  empty name? ──400 invalid_request     └→ DuplicateCategoryNameError → 409
      router.refresh() ←── 200 ←──────────────────────────────────────→ prisma.category.update
                                                                          catch P2025 → CategoryNotFoundError → 404

      "Eliminar" → confirm()      DELETE /api/admin/categories/[id]     deleteCategory()
      fetch DELETE ─────────────→ auth() ──401                        → prisma.category.delete
      router.refresh() ←── 200 {id}                                      catch P2025 → 404
                                                                         catch P2003 → product.count()
                                                                           → CategoryHasProductsError → 409

## File Changes

| File | Action | Description |
|------|--------|-------------|
| `src/modules/catalog/category.service.ts` | Modify | `DuplicateCategoryNameError`, `CategoryNotFoundError`, `CategoryHasProductsError`, `RenameCategoryInput`, `renameCategory`, `deleteCategory` |
| `src/modules/catalog/category.service.test.ts` | Modify | Extend the existing integration suite |
| `src/app/api/admin/categories/[id]/route.ts` | Create | PATCH + DELETE adapter |
| `src/app/api/admin/categories/[id]/route.test.ts` | Create | HTTP tests with `makeAuthMockModule()` from `src/lib/testing/admin-auth-mock.ts` |
| `src/app/admin/(console)/categorias/CategoryRow.tsx` | Create | Client `<tr>`: view/edit modes, delete `confirm()`, `router.refresh()` |
| `src/app/admin/(console)/categorias/CategoryRow.test.tsx` | Create | Component tests, `fetch` stubbed |
| `src/app/admin/(console)/categorias/page.tsx` | Modify | Fourth `Acciones` column header; `<tbody>` maps to `<CategoryRow>`; `colSpan={3}` → `4` |
| `prisma/schema.prisma` | Unchanged | `ON DELETE RESTRICT` (Prisma's default for a required relation) already enforces the block |

## Interfaces / Contracts

```ts
// src/modules/catalog/category.service.ts
export class DuplicateCategoryNameError extends Error {
  constructor(public readonly name: string);      // this.name = "DuplicateCategoryNameError"
}
export class CategoryNotFoundError extends Error {
  constructor(public readonly categoryId: string);
}
export class CategoryHasProductsError extends Error {
  constructor(public readonly categoryId: string, public readonly productCount: number);
  // message: `Category ${id} still has ${productCount} product(s) assigned.`
}
export interface RenameCategoryInput { name: string }   // no `slug` — structurally unwritable

/** Renames only `name`. `slug` is never written (proposal: immutable, zero exceptions).
 *  Case-insensitive collision against every OTHER category → DuplicateCategoryNameError (E1/E2). */
export function renameCategory(
  prisma: PrismaClient, id: string, input: RenameCategoryInput,
): Promise<Category>;

/** Deletes an empty category. The FK's ON DELETE RESTRICT is the single authority:
 *  P2003 → count products → CategoryHasProductsError; P2025 → CategoryNotFoundError (E3). */
export function deleteCategory(prisma: PrismaClient, id: string): Promise<void>;
```

**Route** — `src/app/api/admin/categories/[id]/route.ts`, `interface RouteContext { params: Promise<{ id: string }> }`, mirroring `api/admin/orders/[orderId]/pickup/route.ts`. Both handlers call `auth()` first, then `await context.params`.

`PATCH` body `{ name: string }`, trimmed before validation:

| Status | Body | When |
|---|---|---|
| 200 | `{ id, name, slug }` | Renamed |
| 400 | `{ error: "invalid_request" }` | Unparseable JSON, or `name` missing/empty after trim |
| 400 | `{ error: "slug_immutable", message }` | Body carries a `slug` key at all |
| 401 | `{ error: "unauthenticated" }` | No `auth()` session |
| 404 | `{ error: "category_not_found" }` | `CategoryNotFoundError` |
| 409 | `{ error: "duplicate_name", message }` | `DuplicateCategoryNameError` |

`DELETE`, no body:

| Status | Body | When |
|---|---|---|
| 200 | `{ id }` | Deleted |
| 401 | `{ error: "unauthenticated" }` | No session |
| 404 | `{ error: "category_not_found" }` | `CategoryNotFoundError` |
| 409 | `{ error: "category_has_products", message, productCount }` | `CategoryHasProductsError` |

`204 No Content` was rejected for `DELETE`: every shipped handler in `src/app/api/**` answers with a JSON body, and a uniform body keeps the client's `response.json()` handling identical across all four calls.

Anything else rethrows (Next.js 500), exactly as the create route does.

## UI Shape

No new visual direction — existing Editorial Minimalist tokens only. `page.tsx` gains an `Acciones` column; `CategoryRow` renders `Categoría | Slug | Productos | Acciones`.

**View mode**: name as text, then `Editar` and `Eliminar` as `font-sans text-label-caps uppercase tracking-widest` text buttons, `text-ink` / `text-red-700`. **Edit mode**: the name cell becomes `<input className="border border-ink/20 px-3 py-2">` seeded with the current name, actions become `Guardar` / `Cancelar`. `Escape` cancels; `Enter` submits.

The deliberate detail carries over from `NewCategoryForm`'s slug preview: in edit mode the slug cell renders `/categoria/{slug}` in `text-outline`, unchanged and uneditable, so the owner sees at the moment of renaming that the public URL is not following the label. That is the exact confusion this slice's slug-immutability rule creates, shown rather than explained.

Delete calls native `confirm()` naming the category (resolved refinement): `¿Eliminar "Bijou"? Esta acción no se puede deshacer.` Errors render in the actions cell as `role="alert"` `text-red-700`, mirroring `NewCategoryForm`. Blocked-delete copy names the fix, not just the failure: `No se puede eliminar: tiene 12 productos asignados. Reasigná esos productos primero.` Both handlers call `router.refresh()` on success.

## Testing Strategy

| Layer | What to Test | Approach |
|-------|-------------|----------|
| Integration (service) | `renameCategory` persists `name` and leaves `slug` byte-identical; rejects a name colliding case-insensitively with another category (`"BIJOU"` vs `"bijou"`); **allows** a case-only self-rename; a name containing `%` does not falsely collide (see Risks); unknown id → `CategoryNotFoundError`. `deleteCategory` removes an empty category; throws `CategoryHasProductsError` with the exact `productCount` and deletes nothing when products reference it; unknown id → `CategoryNotFoundError` | Real Postgres, `randomUUID()` suffixes, `afterAll` id cleanup — mirrors the existing `createCategory` suite in `category.service.test.ts` |
| Integration (route) | PATCH: 200 shape, 400 `invalid_request` (empty name), 400 `slug_immutable`, 401 mutates nothing, 404, 409 `duplicate_name`. DELETE: 200 `{ id }`, 401 mutates nothing, 404, 409 `category_has_products` with `productCount` in body | `vi.mock("@/lib/auth", () => makeAuthMockModule())` + real Postgres — mirrors `api/admin/categories/route.test.ts` |
| Component | `Editar` swaps the name cell to an input seeded with the current name; `Cancelar`/`Escape` restores without a fetch; `Guardar` PATCHes `{ name }` and never a `slug` key; server `message` renders in `role="alert"`; `Eliminar` sends no request when `confirm()` returns false and DELETEs when true | `@testing-library/react` + `user-event`, `fetch` and `window.confirm` stubbed — mirrors `NewCategoryForm.test.tsx` |
| E2E | Owner renames a category from `/admin/categorias` and the new label appears in the list and in the product form's picker; deleting a populated category shows the blocking message and removes nothing | One spec following the existing `e2e/admin-*` pattern |

## Threat Matrix

N/A — every row in `references/threat-matrix.md` covers a VCS/shell/subprocess/PR-automation or executable-file-classification boundary. This change adds one HTTP route inside the existing Next.js App Router, gated by the same `auth()` call as every shipped `/api/admin/*` route, and touches no shell, subprocess, git invocation, or file classification. The adversarial cases that do exist (unauthenticated `PATCH`/`DELETE`, a `slug` smuggled into the body, delete of a populated category) are route-contract cases and are required tests above.

## Migration / Rollout

No migration required. Purely additive: no schema change, no change to `createCategory` or to any read path. Rollback is reverting the PR — the `[id]` route, `CategoryRow`, and the two service functions disappear; already-applied renames stay valid `Category` rows.

## Open Questions

- [ ] Prisma's Postgres connector may compile `equals` + `mode: "insensitive"` to `ILIKE`, which treats `%` and `_` in the compared value as wildcards. The E1 test with a `%` in the name decides this at implementation time. If it leaks, the documented fallback is `findMany({ where: { NOT: { id } }, select: { id: true, name: true } })` plus a `toLocaleLowerCase()` comparison in JS — safe here because the admin page already renders every category row. Not design-blocking: E1's contract is unchanged either way.
