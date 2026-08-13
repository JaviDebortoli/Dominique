// Admin route gate (design.md D7: "all /admin/* behind middleware").
//
// Next.js 16 renamed the "middleware.ts" file convention to "proxy.ts"
// (the exported function is now named `proxy`, not `middleware` — see
// https://nextjs.org/docs/app/api-reference/file-conventions/proxy). This
// is that same gate, just renamed to match; the actual authorization logic
// is unchanged from the original tasks.md 7.1 implementation.
//
// This builds its OWN NextAuth instance from ONLY src/lib/auth.config.ts
// (no providers) — deliberately NOT `export { auth as proxy } from
// "@/lib/auth"`, because src/lib/auth.ts pulls in bcryptjs + Prisma. Next.js
// 16's Proxy now defaults to the Node.js runtime (unlike the old Edge
// -only Middleware), so those imports would technically work here too, but
// keeping the split matches next-auth's own documented pattern and keeps
// this file's dependency surface minimal regardless of which runtime a
// future Next.js version defaults Proxy to. See auth.config.ts's module
// doc for the full rationale.
//
// Backs specs/admin-console/spec.md "Authenticated Access" and
// tasks.md 7.1.
import NextAuth from "next-auth";
import { authConfig } from "@/lib/auth.config";

// Next.js 16's build-time static analyzer (get-page-static-info.js) only
// recognizes a Proxy/Middleware export via a SIMPLE identifier variable
// declaration (`export const proxy = ...`) or a real function declaration —
// NOT an object-destructuring export (`export const { auth: proxy } = ...`,
// the pattern next-auth's own docs show). The destructured form builds and
// type-checks fine but fails Next's AST-level "must export a function"
// check at build time with no destructuring support. Two statements avoids
// that entirely.
const { auth } = NextAuth(authConfig);
export const proxy = auth;

export const config = {
  // Guards every /admin/* route (including /admin/login itself — the
  // authorized() callback in auth.config.ts special-cases the login page so
  // it never redirect-loops). Deliberately does NOT match /api/admin/* —
  // admin API routes (e.g. the upload route, tasks.md 7.5) check the
  // session themselves via `auth()` so they can return a JSON 401 instead
  // of an HTML redirect.
  matcher: ["/admin/:path*"],
};
