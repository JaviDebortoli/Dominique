// In-memory, per-process defense-in-depth against admin login brute force /
// bcrypt-cost-12 CPU exhaustion — the app-level fallback for
// deploy/nginx.conf's `admin_login` zone (limit_req_zone ... rate=5r/m).
// Nginx stays the primary defense (its own module doc calls it "the binding
// constraint on brute force"); this exists so a proxy swap, a missing Nginx
// (local `next dev`), or config drift doesn't leave ZERO defense against
// guessing the one real AdminUser's password.
//
// Counts FAILURES only, not every attempt, and a success clears the count
// entirely (recordLoginSuccess). Unlike Nginx's zone (which throttles every
// POST regardless of outcome), this can't afford to: a real admin logging
// in successfully many times in a row is normal traffic (and is exactly
// what e2e/admin-console.spec.ts and friends do — loginAsAdmin() runs
// before nearly every test, all against ONE seeded email, in parallel
// workers) and must never trip a defense meant for wrong-password guessing.
//
// Scope: bounds attempts PER KEY (admin-auth.service.ts calls this with the
// normalized email), not per source IP — it protects the one account
// that's actually at risk. It does NOT bound an attacker cycling through
// many different nonexistent emails to burn bcrypt-cost-12 CPU one compare
// at a time; that flood shape stays Nginx's job (its zone keys by
// $binary_remote_addr, independent of the email in the POST body).
//
// In-memory only: state resets on every process restart, deliberately
// mirroring both Nginx's own self-resetting `limit_req` zone and
// admin-auth.service.ts's "no persistent account lockout" requirement — the
// real owner can always log back in once the window rolls over, a correct
// attempt clears the count, or the process restarts. Safe as process-local
// state because this app runs as a single PM2 fork-mode process, never
// clustered (deploy/ecosystem.config.js) — every request hits the same Map.

const WINDOW_MS = 60_000;
const MAX_FAILURES_PER_WINDOW = 5;

interface Bucket {
  failures: number;
  windowStart: number;
}

const buckets = new Map<string, Bucket>();

function currentBucket(key: string, now: number): Bucket | undefined {
  const bucket = buckets.get(key);
  if (!bucket) return undefined;
  if (now - bucket.windowStart >= WINDOW_MS) {
    buckets.delete(key);
    return undefined;
  }
  return bucket;
}

/** Whether `key` has hit the failure budget for its current window. */
export function isLoginBlocked(key: string, now: number = Date.now()): boolean {
  const bucket = currentBucket(key, now);
  return bucket !== undefined && bucket.failures >= MAX_FAILURES_PER_WINDOW;
}

/** Records one failed login attempt (unknown email or wrong password). */
export function recordLoginFailure(key: string, now: number = Date.now()): void {
  const bucket = currentBucket(key, now);
  if (!bucket) {
    buckets.set(key, { failures: 1, windowStart: now });
    return;
  }
  bucket.failures += 1;
}

/** Clears `key`'s failure count — called on a successful login. */
export function recordLoginSuccess(key: string): void {
  buckets.delete(key);
}

/** Test-only: clears all in-memory state between test cases. */
export function resetLoginRateLimitForTests(): void {
  buckets.clear();
}
