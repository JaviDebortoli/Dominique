import dotenv from "dotenv";

// Load `.env` first (shared secrets: AUTH_SECRET, MP_*), then `.env.test`
// with override so DATABASE_URL points at the isolated test database instead
// of the real dev DB `npm run dev` uses (see .env.test's comment).
dotenv.config();
dotenv.config({ path: ".env.test", override: true });

import "@testing-library/jest-dom/vitest";
