import { randomUUID } from "node:crypto";
import bcrypt from "bcryptjs";
import { afterAll, describe, expect, it } from "vitest";
import { prisma } from "@/lib/db";
import { verifyAdminCredentials } from "./admin-auth.service";

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
});
