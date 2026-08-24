import dotenv from "dotenv";
import { defineConfig, devices } from "@playwright/test";

// Load `.env` first (shared secrets), then `.env.test` with override so
// every DB access below — the spawned `next dev` webServer AND any spec file
// that talks to Prisma directly (e.g. e2e/admin-productos-*.spec.ts) — uses
// the isolated test database instead of the real dev DB (see .env.test).
dotenv.config();
dotenv.config({ path: ".env.test", override: true });

const TEST_DATABASE_URL = process.env.DATABASE_URL;
if (!TEST_DATABASE_URL) {
  throw new Error("DATABASE_URL is not set after loading .env.test — run `npm run db:test:setup` first.");
}

export default defineConfig({
  testDir: "./e2e",
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  workers: process.env.CI ? 1 : undefined,
  reporter: "line",
  use: {
    baseURL: "http://127.0.0.1:3100",
    trace: "on-first-retry",
  },
  projects: [
    {
      name: "chromium",
      use: { ...devices["Desktop Chrome"] },
    },
  ],
  webServer: {
    command: "npm run dev -- -p 3100",
    url: "http://127.0.0.1:3100",
    reuseExistingServer: !process.env.CI,
    timeout: 120_000,
    env: { DATABASE_URL: TEST_DATABASE_URL },
  },
});
