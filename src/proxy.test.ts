// Proxy (formerly "middleware" — Next.js 16 renamed the file convention,
// see proxy.ts's module doc) unit tests — this is the security-critical
// boundary (tasks.md 7.1): an unauthenticated request to any /admin/* route
// MUST be redirected to /admin/login BEFORE any admin page/route body
// runs, so no admin data is ever exposed. Runs under the project's default
// jsdom vitest environment (see vitest.config.mts) — deliberately NOT
// `node`: next-auth's internal `next/server` import only resolves
// correctly through Vite's browser-style module graph here, matching how
// the same bare specifier already resolves in every other route-handler
// test in this repo.
//
// Backs specs/admin-console/spec.md "Authenticated Access" ("Unauthenticated
// access blocked") and design.md D7.
import { NextRequest } from "next/server";
import { describe, expect, it } from "vitest";

// next-auth v5's `auth` export (aliased as `proxy`) is typed as a union of
// several call shapes (session getter, App Router route wrapper, HOF
// middleware/proxy wrapper) — none of its declared overloads is exactly
// "(request: NextRequest) => Promise<Response | undefined>", even though
// that IS how Next.js actually invokes a Proxy export at runtime (and how
// it behaves here, per the passing assertions below). This cast isolates
// that known next-auth v5 typing gap to the test file; it does not change
// src/proxy.ts's own (canonical Auth.js docs pattern) declaration.
type ProxyFn = (request: NextRequest) => Promise<Response | undefined>;

async function callProxy(path: string): Promise<Response | undefined> {
  const { proxy } = await import("./proxy");
  const request = new NextRequest(`http://localhost:3000${path}`);
  return (proxy as unknown as ProxyFn)(request);
}

describe("proxy — unauthenticated /admin/* is blocked, no data exposed (D7, tasks.md 7.1)", () => {
  it("redirects an unauthenticated request to an admin route to /admin/login", async () => {
    const response = await callProxy("/admin/productos");

    expect(response).toBeDefined();
    expect(response!.status).toBeGreaterThanOrEqual(300);
    expect(response!.status).toBeLessThan(400);
    const location = response!.headers.get("location");
    expect(location).toContain("/admin/login");
  });

  it("redirects an unauthenticated request to a nested admin route (e.g. caja) to /admin/login", async () => {
    const response = await callProxy("/admin/caja");

    expect(response).toBeDefined();
    const location = response!.headers.get("location");
    expect(location).toContain("/admin/login");
  });

  it("does not redirect the login page itself (no redirect loop)", async () => {
    const response = await callProxy("/admin/login");

    // Unauthenticated + not logged in ⇒ authorized() falls through to the
    // final `return true` (only the isLoggedIn branch redirects away from
    // /admin/login), so this must NOT be a redirect to /admin/login.
    if (response) {
      const location = response.headers.get("location");
      expect(location ?? "").not.toContain("/admin/login");
    }
  });

  it("lets a non-admin storefront route through untouched", async () => {
    const response = await callProxy("/");

    if (response) {
      expect(response.status).not.toBeGreaterThanOrEqual(300);
    }
  });
});
