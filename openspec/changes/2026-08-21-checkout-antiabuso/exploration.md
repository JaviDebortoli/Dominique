# Exploration: Checkout anti-abuse (fake PICKUP_CASH reservation spam)

## Current State

**Attack path** (`src/app/api/checkout/route.ts` → `src/modules/orders/order.service.ts` → `src/modules/inventory/stock.service.ts`):

1. `validateRequestBody()` (route.ts:64-83) checks ONLY that `buyerName`/`phone`/`email` are non-empty strings — no format validation anywhere. `email: "x"` passes.
2. `createPendingOrder()` → `computeInitialOrderState()` (order.service.ts:64-86): `PICKUP_CASH` → `status: "RESERVED"`, `expiresAt = nextOpenBusinessDayClose(...)`.
3. `hold()` (stock.service.ts:93-120) atomically increments `held` — correct for stock consistency, but has zero caller-identity gate. Nothing distinguishes PICKUP_CASH from MP in terms of required proof-of-intent before the hold lands; MP has a compensation path if the MP preference fails, PICKUP_CASH has none — the hold just lands and 201 returns.

**Nginx** (`deploy/nginx.conf`): exactly one `limit_req_zone` (`mp_webhook`, 5r/s), applied to exactly `/api/webhooks/mercadopago` only (lines 23, 64-66). `/api/checkout` and `/admin/login` both fall through the generic unlimited `location /` block — confirmed, bugs.md's claim is accurate.

**No app-layer rate-limiting code exists anywhere in the repo** — grepped `src/` for rate-limit/throttle patterns, zero hits; no redis/ioredis/upstash/rate-limiter-flexible in `package.json`. This is greenfield work, not a wire-up.

**Hold-duration mechanism** (`src/lib/business-days.ts:91-118`): pure function scanning forward for the next open, non-holiday day (StoreHours seeded Mon-Fri 09:00-19:00, Sat/Sun closed). Worst case confirmed: Friday-evening reservation → held until **Monday 19:00 close** (~2.5-3 days), matching bugs.md's claim; a holiday stacked on Monday pushes further, with only a `MAX_DAYS_SCANNED=366` degenerate-config safety valve (not a real ceiling). The 15-min sweep (`src/jobs/expire-reservations.ts`) works correctly — the bottleneck is entirely that `expiresAt` itself is set days out for PICKUP_CASH, not the sweep cadence.

**`/admin/login`**: Auth.js v5 Credentials + bcrypt, already has a timing-attack mitigation (`DUMMY_HASH` constant-shape compare on unknown-email misses) but **no lockout/rate-limit at all**, and it's exempted from `src/proxy.ts`'s session gate so it's unthrottled from any angle. Important: `docs/bugs.md`'s separate "Problemas a corregir en el futuro" section independently lists **"Sin rate-limit/lockout en /admin/login"** as its own future item — this item's prose mentions `/admin/login` only as supporting evidence that Nginx coverage is too narrow. This is a genuine scoping ambiguity worth an explicit proposal-phase question rather than silently assuming either inclusion or exclusion.

## Affected Areas

- `src/app/api/checkout/route.ts` — `validateRequestBody()` needs real format validation; `POST` handler is where a rate-limit/CAPTCHA gate would sit.
- `src/modules/orders/order.service.ts` — `createPendingOrder()`/`computeInitialOrderState()` — candidate site for a per-identity concurrent-reservation cap and/or window capping.
- `src/lib/business-days.ts` — `nextOpenBusinessDayClose()` is the exact multi-day-hold mechanism; any capping mitigation composes with it.
- `deploy/nginx.conf` — has an easily-extensible `limit_req_zone` pattern currently scoped only to the webhook.
- `openspec/specs/cart-checkout/spec.md` — no existing requirement covers input validation or abuse limits; needs an ADDED/MODIFIED delta.
- `openspec/specs/pickup-reservation/spec.md` — "Bounded Hold Window" has no cap today; only touch this if the proposal chooses to shorten the window (real behavior change, needs explicit sign-off).
- No existing rate-limit or validation-beyond-shape helper exists anywhere to reuse.

## Approaches

1. **Nginx IP `limit_req` on `/api/checkout`** (mirrors existing `mp_webhook` pattern) — Pros: zero app code, proven pattern, cheap. Cons: bypassable via IP rotation; with small boutique stock counts (seed data: 0/3/4/5 units/variant) even a "throttled" rate can exhaust stock in seconds. Effort: Low.
2. **App-layer in-memory rate limiter** (single PM2 process, no cluster mode — same assumption the cron sweep already relies on) — Pros: no new infra, reusable for `/admin/login`. Cons: resets on restart, net-new code, still IP-based. Effort: Low-Medium.
3. **Email/phone format validation** — Pros: closes the "not even plausible" gap cheaply. Cons: alone does nothing against volume abuse. Effort: Low.
4. **Structural cap on concurrent unconfirmed PICKUP_CASH reservations per identity/IP**, inside `createPendingOrder()`'s transaction — Pros: attacks the actual "stock hostage in volume" harm regardless of request rate. Cons: bypassable with many distinct fake identities unless combined with rate limiting. Effort: Medium.
5. **CAPTCHA (e.g. Turnstile)** on checkout — Pros: directly targets bugs.md's "trivial script" threat model. Cons: new dependency, UI-touching, more effort; owner's own brief flags it as possibly first-pass overkill. Effort: Medium-High.
6. **Shorten/cap the PICKUP_CASH hold window** — Pros: reduces blast radius per successful fake reservation. Cons: requires a MODIFIED delta to `pickup-reservation/spec.md`'s documented guarantee and could hurt legitimate weekend customers — real product decision, not a silent side effect. Effort: Low (code) / Medium (spec+decision).

## Recommendation

Layer (3) format validation + (1) Nginx rate limit on `/api/checkout` (near-zero effort, reuses existing pattern) + (4) per-identity reservation cap (the piece that actually bounds worst-case stock lockup, which rate-limiting alone does not for small stock counts). Leave (5) CAPTCHA and (6) window-shortening as explicit open questions for `sdd-propose` rather than assumed — both carry real UX/spec tradeoffs the owner should decide, not infer.

## Risks

- In-memory app-layer limiting resets on deploy/restart — document as a known limitation, not hidden.
- IP-based limiting alone is bypassable by rotation; doesn't bound worst-case stock lockup for small per-variant stock counts without the identity cap.
- Shortening the hold window changes a documented spec guarantee and could disadvantage legitimate weekend/holiday-eve customers — needs explicit sign-off, not silent inclusion.
- `/admin/login` scope ambiguity: bugs.md tracks it as a separate future item even though this item's prose references it — proceeding without asking risks either scope creep or an unaddressed flagged gap.
- Small seed stock counts (single-digit units per variant) mean a rate-limited-but-successful attacker can still exhaust a variant almost instantly — rate limiting gives partial, not complete, mitigation of the core harm.

## Open Questions (resolve before/at proposal)

1. Is `/admin/login` hardening in scope for THIS change, or deferred to its own already-tracked future bugs.md item ("Sin rate-limit/lockout en /admin/login")?
2. Are CAPTCHA and/or hold-window-shortening acceptable for a first pass, or should the cheaper validation + rate-limit + identity-cap combination ship first with those as explicit follow-ups?

## Ready for Proposal

Yes — codebase facts are unambiguous; the two open questions above are product decisions, not missing research.
