# Design: Checkout Anti-Abuse Hardening

## Technical Approach

Three independent guards, each in the layer that owns its concern. (1) Contact-format plausibility joins `validateRequestBody()`'s existing guard chain in `route.ts`, rejecting before any DB work. (2) Two new `limit_req_zone`s in `deploy/nginx.conf` follow the file's own `mp_webhook` recipe verbatim — no app code. (3) A per-identity cap on open `PICKUP_CASH` reservations runs as the first statement inside `createPendingOrder()`'s existing `$transaction`, so it composes with `hold()`'s atomic guard instead of racing it. Additive only: no migration, no new dependency, no change to any existing success path.

**Explicit non-goal**: `nextOpenBusinessDayClose()` and the `PICKUP_CASH` hold window are **not** changed. `computeInitialOrderState()` is untouched and `specs/pickup-reservation/spec.md` "Bounded Hold Window" needs no delta. Reservations are capped in **count**, never shortened in **duration**.

## Architecture Decisions

### Decision: Permissive plausibility helpers, local to `route.ts`

**Choice**: two module-local predicates beside `isNonEmptyString`/`isCheckoutLine`:

```ts
const MAX_EMAIL_LENGTH = 254; // RFC 5321 practical maximum

function isPlausibleEmail(value: string): boolean {
  const trimmed = value.trim();
  return trimmed.length <= MAX_EMAIL_LENGTH && /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(trimmed);
}

function isPlausiblePhone(value: string): boolean {
  const trimmed = value.trim();
  if (!/^[\d\s()+.-]+$/.test(trimmed)) return false;
  const digits = trimmed.replace(/\D/g, "");
  return digits.length >= 8 && digits.length <= 15; // AR local minimum … E.164 maximum
}
```

**Alternatives considered**: a strict Argentina regex (`+54 9 <área> <número>`); a shared `src/lib/contact-validation.ts`; a Zod/validator dependency.
**Rationale**: owner-resolved as "looks like a value of this type", not deliverability. A strict AR regex rejects real inputs (`0385 4...`, `15...`, a WhatsApp number saved with a country prefix) — the proposal's own Med risk. 8 digits is the shortest real AR number without área; 15 is E.164's ceiling. `"x"`, `""`, `"hola"`, `"a@b"` all fail. A shared lib is premature: `route.ts` is the only caller, and this file already keeps its shape predicates local.

### Decision: Discriminated validation result → `invalid_contact` 400 with Spanish `message`

**Choice**: `validateRequestBody` returns a result union instead of `… | null`:

```ts
type CheckoutValidationFailure = { reason: "shape" } | { reason: "contact"; field: "email" | "phone" };
type CheckoutValidationResult =
  | { ok: true; value: ValidatedCheckoutRequest }
  | { ok: false; failure: CheckoutValidationFailure };
```

| Failure | Status | Body |
|---|---|---|
| `shape` (unchanged behavior) | 400 | `{ error: "invalid_request" }` |
| `contact`, `field: "email"` | 400 | `{ error: "invalid_contact", field: "email", message: "Revisá el email: no parece una dirección de correo válida." }` |
| `contact`, `field: "phone"` | 400 | `{ error: "invalid_contact", field: "phone", message: "Revisá el teléfono: ingresá al menos 8 números (podés usar espacios, guiones, paréntesis o +)." }` |

**Alternatives considered**: folding the two checks into the existing boolean chain and keeping the `null` → `invalid_request` response.
**Rationale**: `CheckoutForm.tsx:71-78` renders `body.message` when present and falls back to "No pudimos confirmar tu pedido" otherwise — folding into `null` would show a real customer a generic failure for a one-character typo, with no way to know which field. A discriminated code plus Spanish `message` is exactly the `stock_unavailable` precedent (specific code + structured field + copy). `route.ts` is the function's only caller, so the signature change is two call sites. Copy uses voseo, matching the existing strings.

### Decision: Nginx rates — checkout `20r/m burst=10`, admin login `5r/m burst=5`

**Choice**: mirror the `mp_webhook` recipe (same directives, same file, `limit_req_status 429`, `nodelay`):

```nginx
limit_req_zone $binary_remote_addr zone=checkout:10m rate=20r/m;

# /admin/login is a Next.js server action: the submit POSTs to the page's own
# URL. An empty key is not accounted by nginx, so this map limits submissions
# without ever throttling a plain page load.
map $request_method $admin_login_limit_key {
    POST    $binary_remote_addr;
    default "";
}
limit_req_zone $admin_login_limit_key zone=admin_login:10m rate=5r/m;
```

| Route | rate | burst | Human worst case | Attacker ceiling |
|---|---|---|---|---|
| `/api/checkout` | `20r/m` (1 per 3 s) | `10 nodelay` | one submit, plus 2-4 retries after a validation/stock error, plus other shoppers behind the same CGNAT — all absorbed by the burst with zero added latency | 1 200 attempts/hour/IP instead of thousands per second |
| `/admin/login` | `5r/m` (1 per 12 s) | `5 nodelay` | 5 consecutive mistypes at full speed; a 6th waits 12 s | 300 guesses/hour/IP against bcrypt cost 12 |

**Alternatives considered**: reusing `5r/s` for both; a persistent admin lockout; app-layer in-memory limiting.
**Rationale**: checkout's limit is server protection and flood-blunting, **not** the stock-lockup bound — with 3-5 units per variant, no survivable rate stops exhaustion, which is why layer 3 exists. So it is set generous enough that a real customer can never hit it. Admin login is the opposite: the edge cap is the binding constraint on brute force (and on bcrypt-cost-12 CPU exhaustion — ~250 ms of Node CPU per attempt). `burst=5 nodelay` makes the owner's realistic mistype sequence completely unthrottled, and the window self-heals continuously — owner-resolved: **no persistent lockout, ever**. `/api/checkout` exports only `POST`, so it needs no `map`; `/admin/login` does.

### Decision: Cap counted inside the `hold()` transaction, soft under concurrency

**Choice**: first statement in `createPendingOrder()`'s `$transaction` callback, before `order.create`:

```ts
const MAX_OPEN_PICKUP_RESERVATIONS = 3;

// inside prisma.$transaction(async (tx) => { …
if (input.method === "PICKUP_CASH") {
  const openCount = await tx.order.count({
    where: {
      method: "PICKUP_CASH",
      status: "RESERVED",
      email: input.email,
      phone: input.phone,
      expiresAt: { gt: now },
    },
  });
  if (openCount >= MAX_OPEN_PICKUP_RESERVATIONS) {
    throw new TooManyOpenReservationsError(openCount, MAX_OPEN_PICKUP_RESERVATIONS);
  }
}
```

`new Date()` at line 149 is hoisted to `const now` so the count's cutoff and the order's `expiresAt` share one instant. Both `email` and `phone` must match (owner-resolved: stricter key, so a customer who mistypes one field is never blocked). `expiresAt: { gt: now }` excludes reservations the 15-min sweep has not collected yet; `status: "RESERVED"` excludes every terminal state, so picked-up, cancelled and expired history never counts against a returning customer.

**Alternatives considered**: counting before the transaction; `Serializable` isolation; keying on email-or-phone or on IP; a new `@@index([email, phone])`.
**Rationale**: **confirming the proposal's stated approach** — the count belongs inside the transaction so the guard and `hold()` share one atomic unit: a rejection throws before any write and rolls back to exactly today's behavior, with no compensating release. Refinement to state honestly: Prisma's default Read Committed means two concurrent 4th requests can each read 3 and both pass, so N=3 is a **soft** cap reaching at most N+concurrency transiently. That is accepted — the cap's job is bounding volume (3 vs. 300), and the **stock** guarantee stays exact because `hold()`'s conditional `UPDATE … WHERE onHand-held >= qty` remains the sole authority. `Serializable` would force retry handling into every checkout for a non-safety-critical bound. The query reuses the existing `@@index([status, expiresAt])`; email/phone are a residual filter over a tiny row set, so no migration is needed (proposal constraint).

### Decision: `TooManyOpenReservationsError` carries counts, not identity; route composes 409 copy

**Choice**:

```ts
/** Caps concurrent open PICKUP_CASH reservations per (email, phone). Mirrors
 * TooManyImagesError: carries the observed count and the cap, never the PII. */
export class TooManyOpenReservationsError extends Error {
  constructor(
    public readonly openCount: number,
    public readonly cap: number,
  ) {
    super(`This identity already has ${openCount} open pickup reservation(s); the cap is ${cap}.`);
    this.name = "TooManyOpenReservationsError";
  }
}
```

Route catch block, beside `StockUnavailableError`:

```ts
if (error instanceof TooManyOpenReservationsError) {
  return NextResponse.json(
    {
      error: "too_many_open_reservations",
      message:
        `Ya tenés ${error.cap} reservas para retirar en el local sin confirmar. ` +
        `Pasá a retirarlas o escribinos para cancelar alguna antes de hacer una nueva.`,
    },
    { status: 409 },
  );
}
```

**Alternatives considered**: a generic "no pudimos crear tu pedido"; a 400; the service throwing Spanish; carrying `email`/`phone` as public fields.
**Rationale**: the established convention is service errors English/technical, routes composing Spanish copy (`pickup/route.ts`, `cancel/route.ts`, `stock_unavailable`). 409 not 400 — the same request succeeds once a reservation is picked up or expires, which is a conflict with current state, matching `VariantAttributesImmutableError`'s documented 400-vs-409 reasoning. Owner-resolved: the copy is **explicit** about the rule and the remedy, accepting that it reveals the cap. `TooManyImagesError(productId, currentCount)` is the shape precedent; identity is deliberately kept out of the public fields so the message never carries PII into logs.

## Data Flow

Sequence — checkout stock flow with the identity cap (`PICKUP_CASH`):

    Browser ──POST /api/checkout──→ Nginx (limit_req zone=checkout)
                                      │ over rate → 429, never reaches Node
                                      ▼
                            validateRequestBody()
                              │ shape bad      → 400 invalid_request
                              │ email/phone    → 400 invalid_contact + message
                              ▼
                       createPendingOrder()
                              │ pre-tx: variant fetch + availability → 409 stock_unavailable
                              │ computeInitialOrderState()  ← UNCHANGED (nextOpenBusinessDayClose)
                              ▼
                     $transaction (maxWait/timeout 10 s)
                              │
                              ├─ 1. tx.order.count(RESERVED, PICKUP_CASH, email+phone, expiresAt>now)
                              │        >= 3 → throw ──→ rollback, no row, no hold ──→ 409 message
                              ├─ 2. tx.order.create(RESERVED, expiresAt)
                              └─ 3. hold(tx, …) per line  ← atomic stock authority, unchanged
                                       │ conditional UPDATE fails → rollback
                                       ▼
                                 201 { orderId, publicCode }

## File Changes

| File | Action | Description |
|------|--------|-------------|
| `src/app/api/checkout/route.ts` | Modify | `isPlausibleEmail`/`isPlausiblePhone`; `validateRequestBody` result union; `invalid_contact` 400s; `too_many_open_reservations` 409 |
| `src/app/api/checkout/route.test.ts` | Modify | Format-rejection and cap-rejection integration cases |
| `src/modules/orders/order.service.ts` | Modify | `MAX_OPEN_PICKUP_RESERVATIONS`, `TooManyOpenReservationsError`, in-transaction count, hoisted `now` |
| `src/modules/orders/order.service.test.ts` | Modify | New `describe` for the cap |
| `deploy/nginx.conf` | Modify | `checkout` + `admin_login` zones, `$admin_login_limit_key` map, two `location` blocks |
| `deploy/DEPLOY.md` | Modify | Note the two new zones in the existing `nginx -T` verification step |
| `openspec/specs/cart-checkout/spec.md` | Delta | Contact-format validation + abuse limits |
| `openspec/specs/admin-console/spec.md` | Delta | Login attempt-rate limit under "Authenticated Access" |
| `prisma/schema.prisma`, `src/lib/business-days.ts` | Unchanged | No migration; hold window untouched |

## Testing Strategy

| Layer | What to Test | Approach |
|-------|-------------|----------|
| Unit (route helpers) | `isPlausibleEmail`/`isPlausiblePhone` accept real AR inputs (`0385 421-1234`, `+54 9 385 4211234`, `11 15 2345 6789`) and reject `"x"`, `"a@b"`, `"hola"`, `"1234"`, over-length | Table-driven cases in `route.test.ts` |
| Integration (route) | `email: "x"` / `phone: "x"` → 400 `invalid_contact` with the right `field`, **and no Order row, no `held` change** | Real DB, assert row count and `held` unchanged |
| Integration (route) | Valid `MP` and `PICKUP_CASH` checkouts still 303/201 — no regression | Existing cases must stay green |
| Unit (service, real Postgres) | 3 open `RESERVED` PICKUP_CASH for the same email+phone → 4th throws, `held` unchanged | New `describe`, mirroring the `markPickedUp`/`cancelOrder` blocks |
| Unit (service) | Cap does **not** count: `PICKUP_CASH` past `expiresAt`; `CANCELLED`/`PICKED_UP`/`EXPIRED`; `MP` `PENDING_PAYMENT`; same email + different phone; same phone + different email | Triangulation — one case per exclusion |
| Unit (service) | `method: "MP"` skips the count entirely at 3+ open reservations | Assert success |
| Integration (route) | 4th PICKUP_CASH → 409, `error: "too_many_open_reservations"`, exact Spanish `message` | Assert `body.message` verbatim |
| Component | `invalid_contact` and `too_many_open_reservations` messages render in the form's `role="alert"` | `CheckoutForm.test.tsx`, existing pattern |
| Config (manual) | `nginx -t` passes; `nginx -T` shows both zones; 21st checkout POST in a minute → 429; login page GET unaffected | DEPLOY.md runbook step — no automated harness exists for Nginx |

## Threat Matrix

N/A — no shell command, subprocess, VCS/PR automation, executable-file classification, or process-integration boundary. Rows are Git/commit/push/PR-scoped and none applies. The Nginx `location` and `limit_req` changes are HTTP reverse-proxy configuration, and the API route is in-process HTTP handling — neither is the dispatch boundary this matrix covers. (Follows the `2026-08-18-admin-cancelar-pedido` precedent.)

## Migration / Rollout

No migration required. Nginx ships independently of the app: edit, `nginx -t`, `systemctl reload nginx` — no deploy, and reverting is deleting the zones and location blocks. The two app guards are additive checks inside existing functions; reverting the PR restores today's behavior byte-for-byte. Orders created under the cap are ordinary rows. No feature flag: all three guards are safe-by-default and independently revertible.

## Delivery Separability (for `sdd-tasks`)

The three layers **are** cleanly separable into two PR-sized units:

- **Slice A — edge + input**: `deploy/nginx.conf`, `deploy/DEPLOY.md`, `route.ts` validation helpers and the `invalid_contact` 400s, `route.test.ts` format cases, `admin-console` spec delta. Standalone value, no dependency on Slice B, revertible alone.
- **Slice B — identity cap**: `order.service.ts` + its tests, the `route.ts` catch branch, `route.test.ts` cap case, `cart-checkout` spec delta. Depends on A only for rebase order.

Coupling is one file, two disjoint regions: Slice A edits `validateRequestBody`/helpers (top of `route.ts`), Slice B edits the `POST` catch block (bottom). Stacked as a Feature Branch Chain, B rebases onto A cleanly. Combined authored size is estimated ~350-450 changed lines, so the session's 800-line budget is not the forcing constraint — the split is recommended because the slices demand different review modes (ops config and regex plausibility vs. transaction isolation semantics and DB test fixtures), and because Slice A can ship and reduce exposure while B's tests are still being written. `sdd-tasks` owns the formal budget forecast.

## Open Questions

- [ ] None — all thresholds, the cap key, the copy tone, and the admin-login approach were owner-resolved before this phase.
