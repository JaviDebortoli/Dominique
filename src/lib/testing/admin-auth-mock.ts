// Shared test-only helper for admin API route tests that mock "@/lib/auth"
// (products, upload, stock, orders routes — tasks.md 7.1/7.3/7.5/7.7-7.9).
//
// next-auth v5's `auth` export has a union of several call-signature
// overloads (session getter / route wrapper / middleware HOF — see
// src/middleware.test.ts's module doc for the same underlying typing gap).
// `vi.mocked(auth)` infers from that overloaded type and TS resolves to a
// signature `mockResolvedValueOnce()` calls can't satisfy with a plain
// `Session | null`. This helper isolates that one cast in a single place
// instead of repeating it in every route test file.
import type { Session } from "next-auth";
import { vi, type Mock } from "vitest";

export type MockedAuth = Mock<() => Promise<Session | null>>;

/** Casts an imported (already `vi.mock`-replaced) `auth` binding to a
 * simple, directly-callable mock type. */
export function asMockedAuth(auth: unknown): MockedAuth {
  return auth as MockedAuth;
}

/** A minimal, valid authenticated Session for admin route tests.
 *
 * Deliberately has NO `user.id` by default: routes that record a
 * StockMovement.actorId (stock/sell, stock/adjust) have a real FOREIGN KEY
 * to admin_users — a fabricated id would violate that constraint. Pass a
 * REAL, already-created AdminUser's id via `overrides.id` only in tests
 * that specifically assert on the recorded actorId. */
export function fakeAdminSession(overrides: Partial<Session["user"]> = {}): Session {
  return {
    user: { email: "admin@example.com", name: "Admin", ...overrides },
    expires: new Date(Date.now() + 3600_000).toISOString(),
  };
}

// A shared vi.mock() factory body — each test file still calls
// `vi.mock("@/lib/auth", () => makeAuthMockModule())` itself (vi.mock is
// hoisted per-file by design; it cannot be re-exported/called indirectly).
export function makeAuthMockModule() {
  return { auth: vi.fn() };
}
