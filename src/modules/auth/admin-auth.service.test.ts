import { randomUUID } from "node:crypto";
import bcrypt from "bcryptjs";
import { afterAll, describe, expect, it } from "vitest";
import { prisma } from "@/lib/db";
import { verifyAdminCredentials } from "./admin-auth.service";
import { resetLoginRateLimitForTests } from "./login-rate-limit";

// Integration tests against the real local Postgres (design.md Testing
// Strategy: "no mocked Prisma" for anything DB-shaped).
// Backs specs/admin-console/spec.md "Authenticated Access" and design.md D7
// (Auth.js Credentials + bcrypt). tasks.md 7.1/7.2 — this is the credential
// -verification half of admin login; session-cookie issuance itself is
// framework-level (next-auth) and is proven by e2e/admin-auth.spec.ts.
describe("admin-auth.service — verifyAdminCredentials() (integration, real Postgres)", () => {
  const createdAdminIds: string[] = [];

  afterAll(async () => {
    await prisma.adminUser.deleteMany({ where: { id: { in: createdAdminIds } } });
  });

  async function makeAdmin(email: string, password: string) {
    const passwordHash = await bcrypt.hash(password, 12);
    const admin = await prisma.adminUser.create({
      data: { email, passwordHash, name: "Test Admin" },
    });
    createdAdminIds.push(admin.id);
    return admin;
  }

  it("returns the admin identity for a correct email + password", async () => {
    const suffix = randomUUID();
    const email = `owner-${suffix}@example.com`;
    await makeAdmin(email, "correct-horse-battery-staple");

    const result = await verifyAdminCredentials(prisma, email, "correct-horse-battery-staple");

    expect(result).not.toBeNull();
    expect(result?.email).toBe(email);
  });

  it("returns null for a correct email with the wrong password", async () => {
    const suffix = randomUUID();
    const email = `owner-${suffix}@example.com`;
    await makeAdmin(email, "correct-horse-battery-staple");

    const result = await verifyAdminCredentials(prisma, email, "wrong-password");

    expect(result).toBeNull();
  });

  it("returns null for an email that has no AdminUser row (no data/timing leak)", async () => {
    const result = await verifyAdminCredentials(
      prisma,
      `no-such-admin-${randomUUID()}@example.com`,
      "any-password",
    );

    expect(result).toBeNull();
  });

  it("matches email case-insensitively", async () => {
    const suffix = randomUUID();
    const email = `Owner-${suffix}@Example.com`;
    await makeAdmin(email.toLowerCase(), "correct-horse-battery-staple");

    const result = await verifyAdminCredentials(prisma, email, "correct-horse-battery-staple");

    expect(result).not.toBeNull();
  });

  it("rejects non-string email/password inputs instead of throwing (malformed request body)", async () => {
    await expect(verifyAdminCredentials(prisma, 12345, "x")).resolves.toBeNull();
    await expect(verifyAdminCredentials(prisma, "a@b.com", undefined)).resolves.toBeNull();
  });

  it("rejects empty-string credentials", async () => {
    await expect(verifyAdminCredentials(prisma, "", "")).resolves.toBeNull();
  });

  describe("login rate limiting (app-level fallback for deploy/nginx.conf's admin_login zone)", () => {
    it(
      "rejects further attempts for the same email once the per-email budget is exhausted, even with the correct password",
      async () => {
        resetLoginRateLimitForTests();
        const suffix = randomUUID();
        const email = `rate-limited-${suffix}@example.com`;
        await makeAdmin(email, "correct-horse-battery-staple");

        // Burns the budget with wrong-password attempts, mirroring a real
        // brute-force sequence against one known account. Each of these
        // still runs a real bcrypt-cost-12 compare (only attempts BEYOND
        // the budget skip it) — that's why this needs a longer timeout than
        // the other, single-attempt tests in this file.
        for (let i = 0; i < 5; i++) {
          await verifyAdminCredentials(prisma, email, "wrong-password");
        }

        // Budget's gone for this window: even the CORRECT password is now
        // rejected — same "answer the endpoint, not the password" behavior
        // Nginx's own limit_req zone already has.
        const result = await verifyAdminCredentials(prisma, email, "correct-horse-battery-staple");
        expect(result).toBeNull();
      },
      20_000,
    );

    it(
      "does not exhaust one email's budget when attempts are made against a different email",
      async () => {
        resetLoginRateLimitForTests();
        const suffix = randomUUID();
        const floodedEmail = `flooded-${suffix}@example.com`;
        const ownerEmail = `owner-untouched-${suffix}@example.com`;
        await makeAdmin(ownerEmail, "correct-horse-battery-staple");

        for (let i = 0; i < 5; i++) {
          await verifyAdminCredentials(prisma, floodedEmail, "wrong-password");
        }

        const result = await verifyAdminCredentials(prisma, ownerEmail, "correct-horse-battery-staple");
        expect(result).not.toBeNull();
      },
      20_000,
    );

    it(
      "never blocks repeated CONSECUTIVE successful logins for the same email (matches e2e's loginAsAdmin() pattern, called once per test against one seeded account)",
      async () => {
        resetLoginRateLimitForTests();
        const suffix = randomUUID();
        const email = `repeat-login-${suffix}@example.com`;
        await makeAdmin(email, "correct-horse-battery-staple");

        for (let i = 0; i < 6; i++) {
          const result = await verifyAdminCredentials(prisma, email, "correct-horse-battery-staple");
          expect(result).not.toBeNull();
        }
      },
      30_000,
    );
  });
});
