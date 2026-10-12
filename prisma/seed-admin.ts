// Production-safe admin bootstrap: provisions ONLY the store hours and the
// real first admin account. Unlike `prisma/seed.ts` (dev fixtures), it never
// loads catalog fixtures and refuses to run without ADMIN_SEED_EMAIL and
// ADMIN_SEED_PASSWORD, so it can never create the dev fixture admin
// (admin@dominique.local) in production.
//
// Usage (see deploy/DEPLOY.md step 5):
//   ADMIN_SEED_EMAIL="owner@example.com" ADMIN_SEED_PASSWORD='...' npm run db:seed:admin
import "dotenv/config";
import { pathToFileURL } from "node:url";
import { PrismaClient } from "../src/generated/prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";
import { seedAdminUser, seedStoreHours } from "./seed";

/**
 * Throws a clear error naming every missing/blank variable. Exported so the
 * guard can be unit-tested without a database.
 */
export function requireAdminSeedEnv(env: Record<string, string | undefined>): void {
  const missing = ["ADMIN_SEED_EMAIL", "ADMIN_SEED_PASSWORD"].filter(
    (name) => !env[name]?.trim(),
  );
  if (missing.length > 0) {
    throw new Error(
      `seed-admin: ${missing.join(" and ")} must be set. Refusing to run so the dev fixture admin is never created.`,
    );
  }
}

async function main(): Promise<void> {
  requireAdminSeedEnv(process.env);

  const adapter = new PrismaPg({ connectionString: process.env.DATABASE_URL! });
  const prisma = new PrismaClient({ adapter });

  try {
    await seedStoreHours(prisma);
    await seedAdminUser(prisma);
    console.log("Admin seed complete: store hours + admin login (no catalog fixtures).");
  } finally {
    await prisma.$disconnect();
  }
}

// Run only when executed directly (`tsx prisma/seed-admin.ts`), not when
// imported by tests. Same ESM idiom as prisma/seed.ts.
const isDirectRun =
  process.argv[1] !== undefined &&
  import.meta.url === pathToFileURL(process.argv[1]).href;

if (isDirectRun) {
  main().catch((error) => {
    console.error(error instanceof Error ? error.message : error);
    process.exit(1);
  });
}
