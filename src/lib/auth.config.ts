// Edge-safe Auth.js config (design.md D7: "all /admin/* behind middleware").
//
// Auth.js v5's standard split pattern: this file has NO providers, so it
// never imports bcrypt or Prisma — both are Node.js-only and would break
// (or silently no-op) inside the Edge middleware runtime src/middleware.ts
// runs in. src/lib/auth.ts imports THIS file and adds the real Credentials
// provider on top, for use only from Node.js-runtime code (route handlers,
// server actions) where bcrypt/Prisma are safe to run.
//
// The `authorized()` callback below is the actual access-control decision
// tasks.md 7.1 tests: it runs once per matched request, before any admin
// page or API route body executes, so an unauthenticated request never
// reaches Prisma or renders admin data — it is redirected to /admin/login
// (or, for an unauthenticated JSON API route, effectively denied) by
// next-auth's own middleware wrapper.
import type { NextAuthConfig } from "next-auth";

export const authConfig = {
  pages: {
    signIn: "/admin/login",
  },
  session: {
    strategy: "jwt",
  },
  callbacks: {
    authorized({ auth, request }) {
      const isLoggedIn = Boolean(auth?.user);
      const { pathname } = request.nextUrl;
      const isLoginPage = pathname === "/admin/login";
      const isAdminRoute = pathname.startsWith("/admin");

      if (isAdminRoute && !isLoginPage) {
        // false ⇒ next-auth redirects to `pages.signIn` with a callbackUrl
        // back to the originally requested admin route.
        return isLoggedIn;
      }

      if (isLoginPage && isLoggedIn) {
        // Already-authenticated staff hitting the login page: skip the
        // form and go straight to the console.
        return Response.redirect(new URL("/admin/caja", request.nextUrl));
      }

      return true;
    },
  },
  providers: [], // Real Credentials provider is added in src/lib/auth.ts.
} satisfies NextAuthConfig;
