import { beforeEach, describe, expect, it } from "vitest";
import {
  isLoginBlocked,
  recordLoginFailure,
  recordLoginSuccess,
  resetLoginRateLimitForTests,
} from "./login-rate-limit";

// In-memory, per-process fallback for deploy/nginx.conf's `admin_login`
// zone — see login-rate-limit.ts's module doc for scope and rationale. Pure
// unit tests: no Prisma/Postgres involved.
//
// Counts FAILURES only (not every attempt): a real admin logging in
// successfully many times in a row (which e2e/admin-console.spec.ts and
// friends do constantly, via loginAsAdmin() before nearly every test) must
// never trip this — only a run of wrong-password/unknown-email guesses
// should.
describe("login-rate-limit — in-memory per-key failure budget", () => {
  beforeEach(() => {
    resetLoginRateLimitForTests();
  });

  it("is not blocked before any failure is recorded", () => {
    expect(isLoginBlocked("owner@example.com")).toBe(false);
  });

  it("stays unblocked while under the failure budget", () => {
    const key = "owner@example.com";
    for (let i = 0; i < 4; i++) recordLoginFailure(key);

    expect(isLoginBlocked(key)).toBe(false);
  });

  it("blocks once the failure budget is reached within one window", () => {
    const key = "owner@example.com";
    for (let i = 0; i < 5; i++) recordLoginFailure(key);

    expect(isLoginBlocked(key)).toBe(true);
  });

  it("unblocks once the window has fully elapsed — self-resetting, no persistent lockout", () => {
    const key = "owner@example.com";
    const start = Date.now();
    for (let i = 0; i < 5; i++) recordLoginFailure(key, start);
    expect(isLoginBlocked(key, start)).toBe(true);

    expect(isLoginBlocked(key, start + 60_001)).toBe(false);
  });

  it("a success clears the failure count, so the real owner is never blocked by her own earlier mistypes", () => {
    const key = "owner@example.com";
    for (let i = 0; i < 4; i++) recordLoginFailure(key);
    recordLoginSuccess(key);

    expect(isLoginBlocked(key)).toBe(false);

    // The cleared count means a fresh run of failures is needed to block
    // again — it did not carry over the previous 4.
    for (let i = 0; i < 4; i++) recordLoginFailure(key);
    expect(isLoginBlocked(key)).toBe(false);
  });

  it("tracks independent budgets per key, so flooding one email never blocks another", () => {
    for (let i = 0; i < 5; i++) recordLoginFailure("flooded@example.com");
    expect(isLoginBlocked("flooded@example.com")).toBe(true);

    expect(isLoginBlocked("untouched@example.com")).toBe(false);
  });
});
