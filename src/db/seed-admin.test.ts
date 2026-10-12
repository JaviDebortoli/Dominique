import { describe, expect, it } from "vitest";
import { requireAdminSeedEnv } from "../../prisma/seed-admin";

describe("requireAdminSeedEnv (production admin bootstrap guard)", () => {
  it("rejects a missing ADMIN_SEED_EMAIL so the dev fixture admin is never created", () => {
    expect(() => requireAdminSeedEnv({ ADMIN_SEED_PASSWORD: "s3cret-value" })).toThrow(
      /ADMIN_SEED_EMAIL/,
    );
  });

  it("rejects a missing ADMIN_SEED_PASSWORD", () => {
    expect(() => requireAdminSeedEnv({ ADMIN_SEED_EMAIL: "owner@example.com" })).toThrow(
      /ADMIN_SEED_PASSWORD/,
    );
  });

  it("rejects blank values", () => {
    expect(() =>
      requireAdminSeedEnv({ ADMIN_SEED_EMAIL: "   ", ADMIN_SEED_PASSWORD: "" }),
    ).toThrow(/ADMIN_SEED_EMAIL[\s\S]*ADMIN_SEED_PASSWORD/);
  });

  it("accepts both values", () => {
    expect(() =>
      requireAdminSeedEnv({ ADMIN_SEED_EMAIL: "owner@example.com", ADMIN_SEED_PASSWORD: "s3cret-value" }),
    ).not.toThrow();
  });
});
