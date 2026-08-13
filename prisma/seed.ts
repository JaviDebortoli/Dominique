import "dotenv/config";
import { pathToFileURL } from "node:url";
import bcrypt from "bcryptjs";
import { PrismaClient } from "../src/generated/prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";
import { createProduct } from "../src/modules/catalog/product.service";

// JS Date#getDay convention: 0 = Sunday ... 6 = Saturday.
const STORE_HOURS_SEED = [
  { weekday: 0, closed: true }, // Sunday
  { weekday: 1, closed: false }, // Monday
  { weekday: 2, closed: false }, // Tuesday
  { weekday: 3, closed: false }, // Wednesday
  { weekday: 4, closed: false }, // Thursday
  { weekday: 5, closed: false }, // Friday
  { weekday: 6, closed: true }, // Saturday
] as const;

const DEFAULT_OPENS_AT = new Date("1970-01-01T09:00:00.000Z");
const DEFAULT_CLOSES_AT = new Date("1970-01-01T19:00:00.000Z");

/**
 * Seeds StoreHours (owner-confirmed default, see design.md "Confirmed
 * defaults"): Monday-Friday open, Saturday/Sunday closed. Idempotent —
 * safe to run multiple times (upserts on the unique `weekday`).
 *
 * Holidays are intentionally NOT seeded here: the owner adds them via
 * admin as needed (see design.md Data Model Sketch note).
 */
export async function seedStoreHours(
  prisma: PrismaClient,
): Promise<void> {
  for (const { weekday, closed } of STORE_HOURS_SEED) {
    await prisma.storeHours.upsert({
      where: { weekday },
      create: {
        weekday,
        closed,
        opensAt: DEFAULT_OPENS_AT,
        closesAt: DEFAULT_CLOSES_AT,
      },
      update: {
        closed,
        opensAt: DEFAULT_OPENS_AT,
        closesAt: DEFAULT_CLOSES_AT,
      },
    });
  }
}

// Fixed slugs identify the storefront-browsing (Phase 3) demo/E2E fixtures
// so this function can safely reset-and-recreate them on every run, without
// touching any other data (real orders, admin-entered catalog, etc.). Dev
// and E2E tooling only — never point this seed at a production DATABASE_URL
// (see design.md "Migration / Rollout": greenfield, no prod data migration
// through this script).
const CATALOG_FIXTURE_SLUGS = {
  categories: ["vestidos", "remeras", "accesorios"],
  products: ["vestido-roma", "remera-basica", "cinturon-cuero"],
} as const;

/**
 * Seeds a small, deterministic catalog (3 categories, 1 product each) used
 * by Playwright E2E specs (e2e/home.spec.ts, e2e/category.spec.ts,
 * e2e/pdp.spec.ts) and manual dev preview of app/(store)/**. "Vestido Roma"
 * intentionally has one sold-out size (S) so the PDP "Sin stock" scenario
 * (specs/storefront-browsing/spec.md) has real data to exercise.
 */
export async function seedCatalogFixtures(prisma: PrismaClient): Promise<void> {
  await prisma.product.deleteMany({
    where: { slug: { in: [...CATALOG_FIXTURE_SLUGS.products] } },
  });
  await prisma.category.deleteMany({
    where: { slug: { in: [...CATALOG_FIXTURE_SLUGS.categories] } },
  });

  const vestidos = await prisma.category.create({
    data: { name: "Vestidos", slug: "vestidos" },
  });
  const remeras = await prisma.category.create({
    data: { name: "Remeras", slug: "remeras" },
  });
  const accesorios = await prisma.category.create({
    data: { name: "Accesorios", slug: "accesorios" },
  });

  await createProduct(prisma, {
    name: "Vestido Roma",
    slug: "vestido-roma",
    price: 45000,
    categoryId: vestidos.id,
    variants: [
      { size: "S", color: "Negro", sku: "ROMA-S-NEG", onHand: 0 }, // sold out
      { size: "M", color: "Negro", sku: "ROMA-M-NEG", onHand: 5 },
    ],
    images: [{ url: "/uploads/seed/vestido-roma.jpg", position: 0 }],
  });

  await createProduct(prisma, {
    name: "Remera Basica",
    slug: "remera-basica",
    price: 15000,
    categoryId: remeras.id,
    variants: [{ size: "M", color: "Blanco", sku: "REM-M-BLA", onHand: 3 }],
    images: [{ url: "/uploads/seed/remera-basica.jpg", position: 0 }],
  });

  await createProduct(prisma, {
    name: "Cinturon Cuero",
    slug: "cinturon-cuero",
    price: 18000,
    categoryId: accesorios.id,
    variants: [{ size: "U", color: "Marron", sku: "CIN-U-MAR", onHand: 4 }],
    images: [{ url: "/uploads/seed/cinturon-cuero.jpg", position: 0 }],
  });
}

// ---------------------------------------------------------------------------
// Admin login seed (Phase 7 — tasks.md 7.2, design.md D7: Auth.js
// Credentials + bcrypt). See src/modules/auth/admin-auth.service.ts for the
// login-verification code path this account exercises.
// ---------------------------------------------------------------------------

// DEV-ONLY fixture account — deliberately committed to the repo. This is
// safe ONLY because it unlocks nothing but a local `npx prisma dev`
// database with no real customer/payment/catalog data attached. NEVER copy
// this pattern for a real deployment — see the ADMIN_SEED_EMAIL/
// ADMIN_SEED_PASSWORD branch below and .env.example's Auth.js section for
// how a real environment provisions/rotates its own admin password.
const DEV_ADMIN_EMAIL = "admin@dominique.local";
const DEV_ADMIN_PASSWORD = "Dominique-Dev-Only-2026!";
const BCRYPT_COST_FACTOR = 12;

/**
 * Upserts exactly ONE AdminUser row (idempotent — safe to re-run). Two
 * modes, chosen by whether ADMIN_SEED_EMAIL/ADMIN_SEED_PASSWORD are set in
 * the environment:
 *   - Set (real provisioning path, documented in .env.example): hashes and
 *     upserts THAT email/password. Never logs the password.
 *   - Unset (default, local dev): upserts the DEV-ONLY fixture account
 *     above and logs both the email and password to the console — this is
 *     the ONLY seed path where a password is ever printed, and only
 *     because it is a hardcoded, publicly-known, non-production value
 *     already visible in this file's source.
 */
export async function seedAdminUser(prisma: PrismaClient): Promise<void> {
  const envEmail = process.env.ADMIN_SEED_EMAIL?.trim().toLowerCase();
  const envPassword = process.env.ADMIN_SEED_PASSWORD;

  if (envEmail && envPassword) {
    const passwordHash = await bcrypt.hash(envPassword, BCRYPT_COST_FACTOR);
    await prisma.adminUser.upsert({
      where: { email: envEmail },
      create: { email: envEmail, passwordHash, name: "Admin" },
      update: { passwordHash },
    });
    console.log(`Seed: admin user "${envEmail}" provisioned from ADMIN_SEED_EMAIL/ADMIN_SEED_PASSWORD.`);
    return;
  }

  const passwordHash = await bcrypt.hash(DEV_ADMIN_PASSWORD, BCRYPT_COST_FACTOR);
  await prisma.adminUser.upsert({
    where: { email: DEV_ADMIN_EMAIL },
    create: { email: DEV_ADMIN_EMAIL, passwordHash, name: "Dev Admin" },
    update: { passwordHash },
  });
  console.log(
    `Seed: DEV-ONLY admin login -> email: ${DEV_ADMIN_EMAIL} / password: ${DEV_ADMIN_PASSWORD} (never use in production — set ADMIN_SEED_EMAIL/ADMIN_SEED_PASSWORD instead).`,
  );
}

async function main(): Promise<void> {
  const adapter = new PrismaPg({
    connectionString: process.env.DATABASE_URL!,
  });
  const prisma = new PrismaClient({ adapter });

  try {
    await seedStoreHours(prisma);
    await seedCatalogFixtures(prisma);
    await seedAdminUser(prisma);
    console.log(
      "Seed complete: StoreHours (Mon-Fri open, Sat/Sun closed) + catalog fixtures (Vestidos/Remeras/Accesorios) + admin login.",
    );
  } finally {
    await prisma.$disconnect();
  }
}

// Only run when executed directly (`tsx prisma/seed.ts`), not when imported
// by tests (seed.test.ts imports seedStoreHours directly). This package is
// "type": "module" (package.json), so the CJS `require.main === module`
// idiom never applies here — `require` is undefined under tsx's ESM
// execution and the old `typeof require !== "undefined"` guard silently
// evaluated to false 100% of the time, meaning `main()` never actually ran
// via `npm run db:seed` (discovered while wiring Phase 3 E2E fixtures: the
// script exited 0 with zero console output and zero rows written).
// Comparing import.meta.url to the invoked script's file URL is the
// correct ESM equivalent.
const isDirectRun =
  process.argv[1] !== undefined &&
  import.meta.url === pathToFileURL(process.argv[1]).href;

if (isDirectRun) {
  main().catch((error) => {
    console.error(error);
    process.exit(1);
  });
}
