```yaml
schema: gentle-ai.verify-result/v1
evidence_revision: sha256:9b18632d1d7104001ba190e89e1fcb802a61fecf252366cda528e2b8cbd8f8b6
verdict: pass_with_warnings
blockers: 0
critical_findings: 0
requirements: 1/1
scenarios: 6/6
test_command: npm test
test_exit_code: 0
test_output_hash: sha256:9b18632d1d7104001ba190e89e1fcb802a61fecf252366cda528e2b8cbd8f8b6
build_command: npx tsc --noEmit -p .
build_exit_code: 0
build_output_hash: sha256:e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855
```

## Verification Report

**Change**: 2026-08-20-admin-productos-avanzado
**Version**: Delta modifying admin-console (single MODIFIED requirement: "Product and Variant Management")
**Mode**: Strict TDD, full spec-driven verification (proposal/specs/design/tasks all present)
**Verified against**: combined diff of the 2-branch stacked chain vs main
- PR 1: feat/admin-productos-avanzado-variante -- commit d858953, off main at 9e63ad2
- PR 2: feat/admin-productos-avanzado-imagenes -- stacked off PR 1 branch/commit, working tree carries the image add/delete slice UNCOMMITTED (matches apply-progress documented scope boundary: sdd-apply does not create the PR2 commit)

Verified via combined diff (main vs current working tree, PR1 commit + PR2 uncommitted changes) -- 16 files changed, 1986 insertions, 1 deletion.

## Completeness

15/15 tasks in tasks.md marked complete, spanning Phase 1-8 across 2 stacked PR slices. Verified against actual code state, not just the checkbox claim.

| Phase | Tasks | Status |
|---|---|---|
| 1. Variant-Add Route (PR1) | 1.1-1.2 | confirmed -- variants/route.ts POST adapter over unmodified addVariant() |
| 2. Variant-Add UI (PR1) | 2.1-2.4 | confirmed -- AddVariantForm.tsx + ProductRow.tsx mount |
| 3. Variant-Add E2E (PR1) | 3.1 | confirmed -- e2e/admin-productos-avanzado.spec.ts "owner adds a variant to an existing product" |
| 4. Image Service Add (PR2) | 4.1-4.2 | confirmed -- product.service.ts addImage/TooManyImagesError/MAX_PRODUCT_IMAGES |
| 5. Image Service Delete (PR2) | 5.1-5.2 | confirmed -- product.service.ts deleteImage/ProductImageNotFoundError |
| 6. Image Routes (PR2) | 6.1-6.4 | confirmed -- images/route.ts (POST), images/[imageId]/route.ts (DELETE) |
| 7. Image UI (PR2) | 7.1-7.4 | confirmed -- ProductImages.tsx + ProductRow.tsx mount |
| 8. Image E2E (PR2) | 8.1-8.2 | confirmed -- 2 new e2e scenarios (upload + delete-last) |

## Build & Tests Execution

**Build (typecheck)**: PASS
```text
$ npx tsc --noEmit -p .
(no output, exit 0)
```

**Lint**: PASS -- npx eslint scoped to all 14 files changed/added by this combined diff (product.service.ts/.test.ts, both image route files + tests, variants/route.ts/.test.ts, ProductImages.tsx/.test.tsx, AddVariantForm.tsx/.test.tsx, ProductRow.tsx/.test.tsx, e2e spec) -- 0 errors, 0 warnings.

**Tests**: PASS
```text
$ npm test  (full suite, real Postgres)
Test Files  47 passed (47)
     Tests  381 passed (381)
```
One transient failure occurred on the first full-suite run of this verification session (stock.service.test.ts "exactly one of several parallel hold() calls succeeds on the last unit" -- Connection terminated unexpectedly against the local npx prisma dev proxy). stock.service.ts is untouched by this change. Reproduced the same failure in isolation, then restarted the proxy (npx prisma dev stop default, cleared stale server.lock and server.lock.lock under the LOCALAPPDATA prisma-dev-nodejs durable-streams default folder, npx prisma dev --detach) -- isolated re-run passed 21/21, and a subsequent full clean re-run passed 381/381 with zero failures. This matches the exact pre-existing pglite/dev-proxy instability pattern documented in this change own apply-progress and in the archived 2026-08-18-admin-productos-edicion verify-report -- not a regression introduced by this change.

```text
$ npx playwright test e2e/admin-productos-avanzado.spec.ts --workers=1
3 passed (47.8s)
  - owner adds a variant to an existing product (PR1)
  - owner uploads an image and it appears in the storefront gallery (PR2)
  - owner deletes an image, including the last one (PR2)
```

```text
$ npm test -- <8 focused files for this change>
Test Files  8 passed (8)
     Tests  90 passed (90)
```
(product.service.test.ts, images/route.test.ts, images/[imageId]/route.test.ts, variants/route.test.ts, ProductImages.test.tsx, ProductRow.test.tsx, VariantRow.test.tsx, AddVariantForm.test.tsx)

**Coverage**: Not available -- no coverage tool configured in this project (no --coverage script, no coverage config detected). Reported per Graceful Artifact Handling, not treated as a failure.

## Spec Compliance Matrix

Only the 6 scenarios this change adds to specs/admin-console/spec.md single modified requirement (the other 25 scenarios in that file are inherited unchanged from the prior 2026-08-18-admin-productos-edicion change, already verified in its own archived report).

| # | Scenario | Test | Result |
|---|---|---|---|
| 1 | Owner adds a variant to an existing product | variants/route.test.ts "returns 201 with onHand 0"; AddVariantForm.test.tsx; e2e "owner adds a variant to an existing product" | COMPLIANT |
| 2 | Adding a duplicate size+color variant is rejected | variants/route.test.ts "returns 409 duplicate_variant with Spanish copy built from size/color and creates no variant" (line 232) | COMPLIANT |
| 3 | Owner adds an image to an existing product | images/route.test.ts 201 case; ProductImages.test.tsx; e2e "owner uploads an image and it appears in the storefront gallery" (real file upload, real magic-byte sniff, verifies PDP primary image) | COMPLIANT |
| 4 | Owner deletes an image, including the last remaining one | product.service.test.ts "succeeds on a product LAST remaining image, leaving the product valid with zero images" (asserts remaining.length === 0, product still exists, isProductIncomplete true); images/[imageId]/route.test.ts 200 last-image case; e2e "owner deletes an image, including the last one" | COMPLIANT |
| 5 | Adding a 6th image is rejected | product.service.test.ts "throws TooManyImagesError with currentCount 5 and writes no row when the product already has 5 images" (asserts imageCount === 5 post-attempt, not just the thrown type); images/route.test.ts 409 too_many_images case | COMPLIANT |
| 6 | Unauthenticated mutation on the new variant/image routes returns 401 | variants/route.test.ts line 201; images/route.test.ts line 140; images/[imageId]/route.test.ts line 97 -- each asserts 401 JSON (not a redirect) AND mutates/deletes nothing (row-count/existence check) | COMPLIANT |

**Compliance summary**: 6/6 new scenarios compliant.

## Correctness (Static Evidence) - Design Constraints

| Constraint | Verified as-specced? | Evidence |
|---|---|---|
| onHand/held rejected (400) on add-variant, never constructed for a new variant (G5) | Yes | variants/route.ts line 67: if ("onHand" in rawBody or "held" in rawBody) returns 400 stock_not_editable, checked before validation; validateBody return object literal ({ size, color, sku }) structurally has no onHand key |
| 404 product-not-found guard on add-variant (G6) | Yes | variants/route.ts lines 87-93: PK existence read before calling addVariant(), 404 product_not_found if null; covered by variants/route.test.ts line 219 |
| addVariant() itself unmodified, duplicate size+color check reused | Yes | git diff main product.service.ts shows zero changes to addVariant() -- only new additive code after it; route catches the existing DuplicateVariantError |
| TooManyImagesError at exactly 5, before any write (G1-G3) | Yes | addImage(): one findUnique read answers existence + cap + max-position; if (product.images.length >= MAX_PRODUCT_IMAGES) throws before productImage.create is ever reached; confirmed via test that counts rows post-throw (imageCount === 5, not 6) |
| deleteImage allows removing the last image freely (G4) | Yes | deleteImage(prisma, imageId) -- PK-only signature, no productId/count precondition, relies on P2025 catch only; test explicitly builds a 1-image product, deletes it, and asserts the product row still exists with zero images |
| Unauthenticated returns 401 JSON, not redirect, on all 3 new routes | Yes | All 3 routes: auth() gate first, NextResponse.json with 401; each route test asserts both the 401 status and zero mutation |

## Non-Goals Verification

| Non-goal | Respected? | Evidence |
|---|---|---|
| No route/UI anywhere lets an EXISTING variant onHand/held be edited | Yes | git diff main against variants/[variantId]/route.ts and products/[id]/route.ts -- zero diff, both existing PATCH routes fully untouched by this change. AddVariantForm.tsx (new UI, only touches variant creation) renders no stock input, confirmed via grep for onHand/held/stock -- only a static note ("Empieza en 0. Carga stock desde Caja."), no input element |
| docs/bugs.md point 3 (variant deletion blocks product deletion even without stock) untouched -- no code changes to deleteProduct/deleteVariant | Yes | product.service.ts diff vs main is purely additive (new addImage/deleteImage/error classes appended after addVariant()); deleteProduct and deleteVariant do not appear anywhere in the diff. docs/bugs.md working-tree modification (adding 5 new bullets to "Problemas ahora") is a pre-existing, unrelated, uncommitted local edit -- already flagged as such in both PR1 and PR2 own apply-progress records ("left untouched and unstaged, not part of this commit") |

## Coherence (Design)

| Decision | Followed? | Notes |
|----------|-----------|-------|
| Chained/stacked delivery: PR1 (variant-add) functionally independent of PR2 (image add/delete) | Yes | Confirmed via diff: PR1 files (variants/route.ts, AddVariantForm.tsx) are untouched by PR2 changes except the shared ProductRow.tsx mount point (2 independent tr additions, non-conflicting) |
| ProductImages two-step upload flow (POST /api/admin/upload then POST .../images) | Yes | ProductImages.tsx; e2e "owner uploads an image..." exercises the real upload endpoint end-to-end, not a stub |
| File input disabled at 5 images, reset (not retried) on attach failure after a successful upload (G8) | Yes | ProductImages.test.tsx covers both cases per apply-progress TDD evidence table; covered by the passing 8/8 ProductImages.test.tsx file |

## Issues Found

### CRITICAL
None.

### WARNING
1. PR2 stacked branch has no commit -- feat/admin-productos-avanzado-imagenes currently carries all Phase 4-8 work as uncommitted working-tree changes on top of PR1 commit d858953. This matches sdd-apply documented scope boundary (commit/PR creation deferred to the delivery phase), but it means this verification ran against the working tree, not a frozen commit -- flagging for the delivery phase to commit before opening PR2, consistent with the archived 2026-08-18-admin-productos-edicion pattern.
2. Local npx prisma dev proxy instability reconfirmed -- one transient Connection terminated unexpectedly failure in the unrelated stock.service.test.ts concurrency test on the first full-suite run of this verification session, resolved by a proxy restart; a clean re-run passed 381/381. Same documented pre-existing environment characteristic noted in this change own apply-progress and in the 2026-08-18-admin-productos-edicion archived verify-report -- not a regression, but future sessions should keep budgeting time for it.
3. docs/bugs.md carries a pre-existing, unrelated, uncommitted modification (adding 5 new "Problemas ahora" bullets, including one -- "No existe boton para agregar imagen a un producto" -- that this very change actually resolves but does not mark as resolved). Not authored by this change and explicitly out of scope per both apply-progress records, but flagged again here since it will surface as noise in any diff review of this branch chain unless cleaned up or committed separately before merge.

### SUGGESTION
1. Once PR2 is committed, re-run git diff --stat main..PR2-commit to confirm the frozen commit matches this verification working-tree-based diff stat (16 files, 1986 insertions, 1 deletion, excluding the unrelated docs/bugs.md and openspec tasks.md planning-doc lines) before opening the PR.

## Verdict

**PASS WITH WARNINGS**

All 15/15 tasks complete and verified against actual code, not just checkboxes. All 6 new spec scenarios added by this change pass with real runtime evidence (90/90 focused unit/integration/component tests, 381/381 full suite, 3/3 e2e scenarios against the real running app + real Postgres). Every design constraint (G1-G6) and both non-goals (no existing-variant stock editing, deleteProduct/deleteVariant untouched) are verified directly in the diff, not trusted from the apply-progress narrative. Build (tsc --noEmit) and lint are clean on every file this change touches. The one full-suite failure encountered was a reproduced, pre-existing, environment-level (local Prisma dev proxy) flake in an unrelated file, resolved by a proxy restart with a clean 381/381 re-run as proof. Warnings are all process/hygiene items (PR2 not yet committed, dev-proxy fragility, an unrelated uncommitted docs/bugs.md edit) -- none block the implementation correctness.
