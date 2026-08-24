import dotenv from "dotenv";
import { Client } from "pg";
import { execFileSync } from "node:child_process";

// Provisions the SEPARATE `prisma dev` instance used by Vitest integration
// tests and Playwright e2e (`.env.test`'s DATABASE_URL), so an interrupted
// test run never touches the real dev database in `.env`.
//
// IMPORTANT — isolation here is by `prisma dev` INSTANCE (its own Postgres
// process/data dir), not by database name: this local `prisma dev` proxy
// does not isolate connections by the dbname in the URL — every dbname on
// ONE instance resolves to the SAME physical store (confirmed the hard way;
// see project memory "INCIDENTE: prisma dev no aísla por nombre de DB"). If
// `.env.test` doesn't exist yet, create the test instance first:
//   npx prisma dev --name dominique-test --port 51220 --db-port 51221 \
//     --shadow-db-port 51222 --detach
//   npx prisma dev ls    # confirm the actual TCP port assigned
// then put that TCP port in `.env.test` (see .env.test.example).
//
// This script refuses to run at all if `.env.test`'s host:port matches
// `.env`'s — that mismatch is exactly what caused the incident above.
dotenv.config();
const devDatabaseUrl = process.env.DATABASE_URL;

dotenv.config({ path: ".env.test", override: true });
const testDatabaseUrl = process.env.DATABASE_URL;

if (!testDatabaseUrl) {
  throw new Error("DATABASE_URL is not set after loading .env.test — create that file first (see .env.test.example).");
}
if (!devDatabaseUrl) {
  throw new Error("DATABASE_URL is not set in .env — can't verify test-db isolation without it.");
}

const testUrl = new URL(testDatabaseUrl);
const devUrl = new URL(devDatabaseUrl);
if (testUrl.host === devUrl.host) {
  throw new Error(
    `.env.test's DATABASE_URL host:port (${testUrl.host}) is the SAME as .env's (${devUrl.host}). ` +
      "This local prisma dev proxy does NOT isolate by database name, only by instance/port — " +
      "running this script would operate on the real dev database. Start a separate named instance " +
      "(see this file's header comment) and point .env.test at ITS port instead.",
  );
}

const dbName = testUrl.pathname.slice(1);
if (!dbName) {
  throw new Error(`.env.test's DATABASE_URL has no database name: ${testDatabaseUrl}`);
}

// Wipes the test instance's `public` schema unconditionally before
// migrating, so re-running this script always starts from a genuinely empty
// schema regardless of whatever it currently holds.
async function resetSchema(): Promise<void> {
  const client = new Client({ connectionString: testDatabaseUrl });
  await client.connect();
  try {
    await client.query("DROP SCHEMA public CASCADE; CREATE SCHEMA public;");
    console.log(`Reset "${dbName}"'s public schema to empty.`);
  } finally {
    await client.end();
  }
}

async function main(): Promise<void> {
  await resetSchema();

  const env = { ...process.env, DATABASE_URL: testDatabaseUrl };
  // shell: true — on Windows, `npx` is a .cmd shim that spawnSync can't exec
  // directly (plain "npx.cmd" hits a separate EINVAL without a shell). Safe
  // here: every argument is a static literal below, never user input.
  console.log("Applying migrations to the test database...");
  execFileSync("npx", ["prisma", "migrate", "deploy"], { stdio: "inherit", env, shell: true });

  console.log("Seeding the test database...");
  execFileSync("npx", ["tsx", "prisma/seed.ts"], { stdio: "inherit", env, shell: true });

  console.log("Test database ready.");
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
