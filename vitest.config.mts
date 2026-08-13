import { defineConfig } from "vitest/config";
import react from "@vitejs/plugin-react";
import path from "node:path";

export default defineConfig({
  plugins: [react()],
  test: {
    pool: "threads",
    // Integration tests (product.service, category.service, seed) each open
    // their own PrismaClient/pg connection against the local `npx prisma
    // dev` Postgres proxy. Running test files in parallel makes that proxy
    // cross-talk concurrent Bind messages on different connections (PG
    // error 08P01: "bind message supplies N parameters, but prepared
    // statement \"\" requires 0") — a known pgbouncer-style transaction-
    // pooling incompatibility with the extended query protocol, not a test
    // logic bug (verified: the same files pass 100% with parallelism off).
    fileParallelism: false,
    environment: "jsdom",
    setupFiles: ["./vitest.setup.ts"],
    include: ["src/**/*.{test,spec}.{ts,tsx}", "deploy/**/*.{test,spec}.{ts,tsx}"],
    exclude: ["e2e/**", "node_modules/**"],
    globals: true,
    server: {
      deps: {
        // next-auth's internal modules import the bare specifier
        // "next/server" (no extension). `next`'s package.json has no
        // "exports" field, so plain Node ESM resolution (used for
        // externalized deps) requires an explicit ".js" and fails with
        // ERR_MODULE_NOT_FOUND. Forcing next-auth through Vite's own
        // transform/resolve pipeline (which does extensionless resolution,
        // same as every in-repo route.ts already relies on for its own
        // `next/server` import) fixes it — Phase 7 admin auth (D7).
        inline: [/next-auth/],
      },
    },
  },
  resolve: {
    alias: {
      "@": path.resolve(import.meta.dirname, "./src"),
    },
  },
});
