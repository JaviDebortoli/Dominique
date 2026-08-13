// Admin auth module — the sole credential-verification code path (design.md
// D1: business logic lives in src/modules/*, not inside route handlers or
// framework callbacks). Both src/lib/auth.ts's Credentials `authorize()`
// and any future admin-provisioning tooling should call this, never
// re-implement the bcrypt comparison inline.
//
// Backs specs/admin-console/spec.md "Authenticated Access" and design.md D7
// (Auth.js Credentials + bcrypt, all /admin/* behind middleware). tasks.md
// 7.1/7.2.
//
// This file is Node.js-only (bcryptjs + Prisma) — it MUST NOT be imported
// from src/middleware.ts or src/lib/auth.config.ts, both of which run in
// the Edge middleware runtime. See src/lib/auth.config.ts's module doc for
// the split-config pattern that keeps this out of the Edge bundle.

import bcrypt from "bcryptjs";
import type { PrismaClient } from "@/generated/prisma/client";

export interface AdminIdentity {
  id: string;
  email: string;
  name: string | null;
}

// A syntactically valid bcrypt hash that matches no real password. Running
// bcrypt.compare() against it when the email lookup misses keeps the "no
// such admin" path taking roughly the same wall-clock time as a "wrong
// password" path — bcrypt.compare() is the expensive step, so skipping it
// entirely on a miss would let an attacker distinguish "valid email, wrong
// password" from "no such email" via response timing.
const DUMMY_HASH = "$2b$12$9WmUZJFlj/vt5XOWm9zq8eGgH4zC69Jr7Y.b7QeqGApdDwFC9F8tS";

/**
 * Verifies an admin login attempt against the AdminUser table. Returns the
 * minimal identity needed for the session JWT on success, or `null` on any
 * failure (unknown email, wrong password, malformed input) — the caller
 * (Credentials provider's `authorize()`) maps `null` to a generic
 * "invalid credentials" outcome, never distinguishing "no such user" from
 * "wrong password" to the client.
 */
export async function verifyAdminCredentials(
  prisma: PrismaClient,
  email: unknown,
  password: unknown,
): Promise<AdminIdentity | null> {
  if (typeof email !== "string" || typeof password !== "string") {
    return null;
  }

  const normalizedEmail = email.trim().toLowerCase();
  if (!normalizedEmail || !password) {
    return null;
  }

  const admin = await prisma.adminUser.findUnique({ where: { email: normalizedEmail } });
  if (!admin) {
    await bcrypt.compare(password, DUMMY_HASH);
    return null;
  }

  const valid = await bcrypt.compare(password, admin.passwordHash);
  if (!valid) {
    return null;
  }

  return { id: admin.id, email: admin.email, name: admin.name };
}
