# Proposal: Checkout Anti-Abuse Hardening

## Intent

`docs/bugs.md` — `POST /api/checkout` accepts any non-empty string as email/phone (`validateRequestBody()`, `route.ts:64-83`), is rate-limited at no layer, and places a real stock `hold()` for `PICKUP_CASH` with zero proof of intent. A trivial script can reserve every variant under fake identities; each hold survives until `nextOpenBusinessDayClose()` — Monday close for a Friday-evening order. With single-digit per-variant stock, one run leaves the storefront unsellable for days. Nginx rate-limits only `/api/webhooks/mercadopago`; `/admin/login` is likewise unthrottled and has no lockout despite bcrypt + `DUMMY_HASH`.

## Scope

### In Scope

- Email/phone format validation in `validateRequestBody()` — reject implausible values before any DB work
- Nginx `limit_req_zone` + `limit_req` on `/api/checkout`, mirroring the `mp_webhook` recipe
- Same Nginx treatment for `/admin/login` (closes the separately tracked bugs.md future item)
- Cap on concurrent unconfirmed `PICKUP_CASH` reservations per identity (email/phone) and/or IP, inside `createPendingOrder()`'s existing `$transaction`
- `cart-checkout` and `admin-console` spec deltas

### Out of Scope

- CAPTCHA/Turnstile — deferred follow-up (new dependency + checkout UI friction)
- Shortening the PICKUP_CASH hold window — deferred; changes a documented `pickup-reservation` guarantee and can hurt legitimate weekend customers
- Redis or any shared rate-limit store; defense against IP rotation
- Any Prisma migration; any persisted admin-lockout state

## Capabilities

### New Capabilities

- None

### Modified Capabilities

- `cart-checkout`: add checkout input-format validation and abuse limits (request rate + per-identity concurrent unconfirmed reservation cap). No requirement covers either today.
- `admin-console`: "Authenticated Access" gains a login attempt-rate limit.

`pickup-reservation` "Bounded Hold Window" stays deliberately unchanged.

## Approach

Three independent layers, cheapest first. Validation is a local change to the existing shape checks. Nginx reuses the file's own documented `limit_req_zone` pattern — new zones, two `limit_req` lines, no app code. The identity cap is the only structural piece: count live unexpired `PICKUP_CASH` reservations for the submitted identity inside the same transaction that already runs `hold()`, so it composes with the atomic stock guard instead of racing it.

## Affected Areas

| Area | Impact | Description |
|------|--------|-------------|
| `src/app/api/checkout/route.ts` | Modified | Email/phone format validation; 400 on reject |
| `src/modules/orders/order.service.ts` | Modified | Per-identity reservation cap in `createPendingOrder()` |
| `deploy/nginx.conf` | Modified | `limit_req` zones for `/api/checkout` and `/admin/login` |
| `prisma/schema.prisma` | Unchanged | No migration |
| `src/lib/business-days.ts` | Unchanged | Hold window untouched |

## Risks

| Risk | Likelihood | Mitigation |
|------|------------|------------|
| Legitimate repeat customer hits the reservation cap | Med | Cap keys on email AND phone together (both must match), so a typo on one field never blocks a real repeat customer; explicit rejection copy tells them how to resolve it |
| Explicit rejection copy reveals the exact rule to a would-be attacker | Low | Accepted tradeoff (owner decision) — the copy's value to real confused customers outweighs the marginal information given to an attacker who is already probing the endpoint |
| IP rate limit is bypassable by rotation | High | Accepted. The identity cap is the layer that bounds stock lockup |
| Strict regex rejects a real Argentine phone/email | Med | Permissive format check only, not deliverability verification |
| Attacker cycles many distinct fake identities | Med | Raises cost; CAPTCHA stays the tracked follow-up |
| Owner throttled out of `/admin/login` | Low | Edge rate limit only, no persistent lockout; self-resets |

## Rollback Plan

Three separable reverts. Nginx: drop the zones and `limit_req` lines, reload — no app deploy. Validation and the identity cap are additive guards inside existing functions; reverting the PR restores today's behavior exactly. No migration, no data written, no order shape changed — orders created under the cap are ordinary rows.

## Dependencies

- None. No new package, no new infrastructure.

## Success Criteria

- [ ] `email: "x"` / `phone: "x"` return 400 and create no order and no hold
- [ ] Exceeding the configured rate on `/api/checkout` is rejected by Nginx before Node
- [ ] The same identity cannot hold more than N concurrent unconfirmed `PICKUP_CASH` reservations; the N+1th is rejected with no stock held
- [ ] Repeated `/admin/login` POSTs are throttled at the edge
- [ ] A normal single-order checkout is unaffected for both methods, and `nextOpenBusinessDayClose()` behavior is unchanged

## Open Decisions — RESOLVED (owner, before this proposal)

- **`/admin/login` hardening**: in scope for this change, not deferred.
- **First pass**: validation + Nginx rate limit + identity cap. CAPTCHA and hold-window shortening are explicit follow-ups, not silent inclusions.

## Open Decisions — thresholds RESOLVED (owner, before spec)

- **Concurrent unconfirmed `PICKUP_CASH` cap per identity**: `N = 3`.
- **Cap key**: email AND phone together (both must match an existing open reservation for it to count against the cap) — stricter than either alone; a customer who mistypes one field on a second order is not blocked.
- **Rejection copy**: explicit — tells the customer they already have open reservations and how to resolve it (mirrors the archived cancel change's precedent of actionable Spanish copy naming the real remedy), accepting that this reveals the rule to a would-be attacker.
- **Phone/email format check**: permissive "looks like a value of this type" only (rejects obvious garbage like `"x"` or empty), not a strict Argentina-specific phone regex — avoids rejecting real Santiago del Estero customers who write numbers inconsistently (with/without leading `0`, `15`, area code).
- **`/admin/login` throttle**: edge rate limit only (Nginx `limit_req`, self-resetting), explicitly NO persistent lockout — the owner must never be able to lock herself out of her own panel.
- Rate/burst numeric values for the two Nginx zones are still `sdd-design`'s to propose (mirroring the existing `mp_webhook` 5r/s recipe), not a business-rule the owner needs to pick by hand.

## Delivery Note for `sdd-tasks`

Three distinct concerns (checkout validation; checkout rate limit + identity cap; admin-login rate limit) across app code and `deploy/nginx.conf`. Against the session's 800-line budget the forecast is **Medium-High**; the prior `2026-08-18-admin-cancelar-pedido` change needed a 2-PR split. Recommend slicing at minimum: (1) validation + Nginx zones, (2) identity cap + spec deltas.
