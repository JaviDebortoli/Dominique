# Tasks: Checkout Anti-Abuse Hardening

## Review Workload Forecast

| Field | Value |
|-------|-------|
| Estimated changed lines | ~350-450 total (Slice A ~180, Slice B ~180) |
| 400-line budget risk | Low (vs. session's 800-line budget) |
| Chained PRs recommended | Yes — different review modes, not size-forced |
| Suggested split | PR 1 (Slice A: edge+input) -> PR 2 (Slice B: identity cap) |
| Delivery strategy | ask-on-risk |
| Chain strategy | feature-branch-chain |

Decision needed before apply: Yes
Chained PRs recommended: Yes
Chain strategy: feature-branch-chain
400-line budget risk: Low

### Suggested Work Units

| Unit | Goal | Likely PR | Focused test command | Runtime harness | Rollback boundary |
|------|------|-----------|----------------------|-----------------|-------------------|
| 1 | Contact validation + edge rate limits (checkout + admin login) | PR 1 | `npm test -- route.test.ts CheckoutForm.test.tsx` | Manual: `nginx -t`, `nginx -T \| grep limit_req_zone`, 21 POSTs/min burst | Revert `route.ts` helpers + `nginx.conf` zones/locations; no migration |
| 2 | Per-identity PICKUP_CASH reservation cap | PR 2 | `npm test -- order.service.test.ts route.test.ts` | N/A — real-Postgres integration tests are the harness | Revert `order.service.ts` count check + `route.ts` catch branch; no migration |

## Phase 1: Contact Format Validation (`route.ts`)

- [x] 1.1 RED `route.test.ts`: `email:"x"` -> 400 `invalid_contact`/field `email`; `phone:"x"`/empty -> 400 `invalid_contact`/field `phone`; AR phone variants (no leading 0, with `15`, with/without area code) accepted
- [x] 1.2 GREEN `route.ts`: add `isPlausibleEmail`/`isPlausiblePhone`; change `validateRequestBody` to return `CheckoutValidationResult` (`shape` | `contact`)
- [x] 1.3 GREEN `route.ts` `POST`: branch on result — `shape` -> existing `400 invalid_request`; `contact` -> `400 { error:"invalid_contact", field, message }` (Spanish copy per design.md)
- [x] 1.4 RED `CheckoutForm.test.tsx`: assert `body.message` renders in `role="alert"` for `invalid_contact` (existing generic renderer)
- [x] 1.5 Verify: `CheckoutForm.tsx` needs no code change — 1.4 passes against current generic `body.message` renderer (lines 71-78)

## Phase 2: Nginx Rate Limiting (edge, manual verification — no automated harness)

- [x] 2.1 `deploy/nginx.conf`: add `limit_req_zone $binary_remote_addr zone=checkout:10m rate=20r/m;` beside `mp_webhook`
- [x] 2.2 `deploy/nginx.conf`: add `$admin_login_limit_key` map (`POST`->`$binary_remote_addr`, default `""`) + `limit_req_zone zone=admin_login:10m rate=5r/m;`
- [x] 2.3 `deploy/nginx.conf`: `location /api/checkout` block — `limit_req zone=checkout burst=10 nodelay; limit_req_status 429;`
- [x] 2.4 `deploy/nginx.conf`: `location /admin/login` block — `limit_req zone=admin_login burst=5 nodelay; limit_req_status 429;`
- [x] 2.5 `deploy/DEPLOY.md`: extend `nginx -T | grep limit_req_zone` verification step to list `checkout` and `admin_login`
- [x] 2.6 Manual runbook step (DEPLOY.md, no test file): `nginx -t`; `nginx -T` shows 3 zones; 21st `/api/checkout` POST in a minute -> 429; `/admin/login` GET unaffected

## Phase 3: Per-Identity Reservation Cap (`order.service.ts`, `route.ts`)

- [x] 3.1 RED `order.service.test.ts`: 3 open `RESERVED` PICKUP_CASH (same email+phone) -> 4th throws `TooManyOpenReservationsError`, `held` unchanged
- [x] 3.2 RED `order.service.test.ts`: 2 open -> 3rd succeeds; exclusions (expired, CANCELLED/PICKED_UP/EXPIRED, MP PENDING_PAYMENT, partial email/phone match) proceed normally; `method:"MP"` skips count at 3+ open
- [x] 3.3 GREEN `order.service.ts`: add `MAX_OPEN_PICKUP_RESERVATIONS=3`, `TooManyOpenReservationsError`, hoist `now`, add `tx.order.count(...)` guard as first statement in `createPendingOrder()`'s `$transaction`
- [x] 3.4 RED `route.test.ts`: 4th PICKUP_CASH for same identity -> `409 { error:"too_many_open_reservations", message }` (exact Spanish copy), no order row, no hold
- [x] 3.5 GREEN `route.ts`: import `TooManyOpenReservationsError`; add catch branch composing the 409 response beside `StockUnavailableError`

## Phase 4: Spec Sync (archive-time, no app code)

- [x] 4.1 Confirm `specs/cart-checkout/spec.md` and `specs/admin-console/spec.md` deltas match shipped behavior before archive — deltas already match shipped behavior (verified against route.ts/order.service.ts/nginx.conf during this apply run); no edit needed, final confirmation still owned by `sdd-archive`

## File Conflict Assessment — `route.ts` (Phase 1 vs Phase 3)

Safely separable, not a real conflict risk. Phase 1 touches lines ~43-83 (helpers + `validateRequestBody`) and ~150-153 (result branch). Phase 3 touches ~18-24 (new import) and ~166-182 (catch block only). No overlapping ranges — a Phase 3 branch rebased onto merged Phase 1 applies cleanly. Only shared surface: both add an import near line 18-24; landing out of order needs at most a one-line import reorder, not a merge conflict.

Realized as one combined edit (single-PR delivery, owner-selected) rather than two branches — same non-overlapping ranges, applied together with no conflict.

## Apply-Time Discovery: shared `guestContact()` fixture needed per-call uniqueness

Not a task listed above, but required for Phase 3 GREEN (3.3) not to break pre-existing tests: `order.service.test.ts`'s `guestContact()` helper returned a **fixed** `email`/`phone` constant (`"guest@example.com"` / `"3815551234"`) reused across ~15 call sites in that file. Once the per-identity cap counts open `RESERVED` `PICKUP_CASH` orders by exact `email`+`phone` match table-wide (not scoped to a test's own variant/product), three pre-existing tests that create a `PICKUP_CASH` reservation with that constant identity and never cancel/pick it up (D5's multi-variant test, both `createPendingOrder — PICKUP_CASH` tests) would accumulate to the cap, and a fourth pre-existing test using the same constant identity (`markPickedUp`'s `RESERVED -> PICKED_UP` case) would then fail with `TooManyOpenReservationsError` — a regression the design/tasks split didn't anticipate because it predates this change.

Fix: `guestContact()` now generates a fresh `randomUUID()`-based `email`/`phone` per call (mirroring the file's existing `makeProductWithVariant()` uniqueness pattern). No existing test asserted a specific email/phone value, so this is a safe, non-breaking change. Verified: full `order.service.test.ts` suite (40 tests) green after the fix, both before and after Phase 3.3's GREEN implementation.
