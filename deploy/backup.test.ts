// tasks.md 8.3 — RED→GREEN: deploy/backup.sh must produce a RESTORABLE
// dump, proven by actually restoring it and comparing row counts — not
// just "the script exists" or "it exits 0".
//
// IMPORTANT — why this test uses a stand-in for the real `pg_dump` binary:
// this sandbox's local "Postgres" (`npx prisma dev`) is PGlite, an
// in-process WASM Postgres with no real `pg_dump`/`psql` executables, and
// this Windows dev box has no system PostgreSQL install either (verified:
// neither `pg_dump` nor `psql` exist anywhere on PATH or in node_modules as
// real CLI binaries — only `@electric-sql/pglite-tools`' `pgDump()`, which
// operates on an in-process `PGlite` object, not a network connection
// string, so it cannot stand in for a CLI on PATH). See
// deploy/testing/fake-pg-dump.cjs's module doc for the full rationale and
// exactly what it does and does not reproduce.
//
// What this test actually proves:
//   1. deploy/backup.sh's OWN bash logic is exercised unmodified: env
//      validation, `pg_dump <url> --no-owner --no-privileges --format=plain
//      -f <file>` invocation, empty-dump-file failure handling, and the
//      retention-pruning `find ... -mmin +N -delete` logic — all run for
//      real via a real `bash deploy/backup.sh` subprocess.
//   2. The DUMP FILE IT PRODUCES is restorable: this test restores it into
//      a fresh scratch Postgres SCHEMA (in the same locally running
//      database — the closest equivalent to "a scratch database" this
//      sandbox's single-database PGlite setup supports) and asserts every
//      table's row count in the restored schema matches the source schema
//      at dump time, exactly.
//   3. Retention pruning actually deletes old dumps and keeps recent ones.
//
// On the real DonWeb VPS (deploy/DEPLOY.md), `pg_dump` is the REAL
// PostgreSQL client tool (installed via `apt install postgresql-client`),
// and backup.sh runs completely unmodified against it — this test never
// touches backup.sh's own source, only the PATH it resolves `pg_dump`
// through.
import { execFileSync } from "node:child_process";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  utimesSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { Client } from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

const REPO_ROOT = path.resolve(import.meta.dirname, "..");
const BACKUP_SCRIPT = path.join(REPO_ROOT, "deploy", "backup.sh");
const FAKE_PG_DUMP = path.join(REPO_ROOT, "deploy", "testing", "fake-pg-dump.cjs");

// Every base table backup.sh's dump is expected to round-trip (mirrors
// prisma/schema.prisma's @@map names).
const EXPECTED_TABLES = [
  "categories",
  "products",
  "product_images",
  "variants",
  "orders",
  "order_items",
  "payments",
  "stock_movements",
  "admin_users",
  "store_hours",
  "holidays",
  "newsletter_signups",
];

function makeFakeBinDir(): string {
  const dir = mkdtempSync(path.join(tmpdir(), "dominique-fake-pg-bin-"));
  // A `pg_dump` shebang script on PATH — git-bash/MSYS (this repo's shell,
  // per env docs) executes shebang scripts directly when found via PATH,
  // the same way backup.sh will find the REAL `pg_dump` on the VPS.
  const wrapperPath = path.join(dir, "pg_dump");
  const nodeCjsPath = FAKE_PG_DUMP.replace(/\\/g, "/");
  writeFileSync(wrapperPath, `#!/usr/bin/env bash\nexec node "${nodeCjsPath}" "$@"\n`, {
    mode: 0o755,
  });
  return dir;
}

async function tableCounts(client: Client, schema: string): Promise<Record<string, number>> {
  const counts: Record<string, number> = {};
  for (const table of EXPECTED_TABLES) {
    const { rows } = await client.query(`SELECT COUNT(*)::int AS n FROM "${schema}"."${table}"`);
    counts[table] = rows[0].n;
  }
  return counts;
}

describe("deploy/backup.sh (tasks.md 8.3, real Postgres — dump-and-restore round trip)", () => {
  const databaseUrl = process.env.DATABASE_URL!;
  let fakeBinDir: string;
  let backupDir: string;
  const scratchSchema = "backup_restore_test";

  beforeAll(() => {
    expect(databaseUrl, "DATABASE_URL must be set (see .env / README dev setup)").toBeTruthy();
    fakeBinDir = makeFakeBinDir();
    backupDir = mkdtempSync(path.join(tmpdir(), "dominique-backups-"));
  });

  afterAll(async () => {
    rmSync(fakeBinDir, { recursive: true, force: true });
    rmSync(backupDir, { recursive: true, force: true });
    const client = new Client({ connectionString: databaseUrl });
    await client.connect();
    await client.query(`DROP SCHEMA IF EXISTS "${scratchSchema}" CASCADE`);
    await client.end();
  });

  it("produces a dump that restores into a scratch schema with matching row counts for every table", async () => {
    const sourceClient = new Client({ connectionString: databaseUrl });
    await sourceClient.connect();
    const sourceCounts = await tableCounts(sourceClient, "public");
    await sourceClient.end();

    // Sanity: the seeded DB actually has rows to prove — an all-zeros
    // round trip would pass trivially and prove nothing.
    const totalSourceRows = Object.values(sourceCounts).reduce((a, b) => a + b, 0);
    expect(totalSourceRows).toBeGreaterThan(0);

    const result = execFileSync("bash", [BACKUP_SCRIPT], {
      cwd: REPO_ROOT,
      env: {
        ...process.env,
        DATABASE_URL: databaseUrl,
        BACKUP_DIR: backupDir,
        PATH: `${fakeBinDir}${path.delimiter}${process.env.PATH}`,
      },
      encoding: "utf8",
    });

    expect(result).toContain("backup.sh: done ->");

    const dumpFiles = readdirSync(backupDir).filter((f: string) => f.endsWith(".sql"));
    expect(dumpFiles).toHaveLength(1);
    const dumpPath = path.join(backupDir, dumpFiles[0]);
    expect(dumpFiles[0]).toMatch(/^dominique-\d{8}T\d{6}Z\.sql$/);

    const dumpSql = readFileSync(dumpPath, "utf8");
    expect(dumpSql.length).toBeGreaterThan(0);

    // --- Restore into a scratch schema and verify row counts match -------
    //
    // IMPORTANT: this local sandbox's `npx prisma dev` proxy multiplexes
    // logical `pg.Client` connections onto ONE shared backend session (a
    // pooling limitation, not a PGlite fundamental) — a plain session-level
    // `SET search_path` was observed to LEAK across unrelated connections
    // (including future, otherwise-unrelated test runs and even the dev
    // server) once set this way. `SET LOCAL` inside the SAME transaction as
    // the restore avoids that entirely: it is scoped to the transaction and
    // is automatically discarded at COMMIT, regardless of connection
    // pooling/reuse. The dump SQL already wraps its statements in its own
    // `BEGIN; ... COMMIT;` (see fake-pg-dump.cjs) — the redirect is spliced
    // into that same transaction rather than sent as a separate statement.
    const restoreClient = new Client({ connectionString: databaseUrl });
    await restoreClient.connect();
    try {
      await restoreClient.query(`DROP SCHEMA IF EXISTS "${scratchSchema}" CASCADE`);
      await restoreClient.query(`CREATE SCHEMA "${scratchSchema}"`);
      const scopedRestoreSql = dumpSql.replace(
        /^BEGIN;/m,
        `BEGIN;\nSET LOCAL search_path TO "${scratchSchema}";`,
      );
      expect(scopedRestoreSql).not.toBe(dumpSql); // sanity: the splice actually matched
      await restoreClient.query(scopedRestoreSql);

      const restoredCounts = await tableCounts(restoreClient, scratchSchema);
      expect(restoredCounts).toEqual(sourceCounts);
    } finally {
      await restoreClient.end();
    }
  }, 30_000);

  it("prunes dumps older than the retention window and keeps recent ones", () => {
    mkdirSync(backupDir, { recursive: true });
    const staleFile = path.join(backupDir, "dominique-20200101T000000Z.sql");
    writeFileSync(staleFile, "-- stale\n");
    const oldTime = new Date(Date.now() - 60 * 60 * 1000); // 1 hour ago
    utimesSync(staleFile, oldTime, oldTime);

    execFileSync("bash", [BACKUP_SCRIPT], {
      cwd: REPO_ROOT,
      env: {
        ...process.env,
        DATABASE_URL: databaseUrl,
        BACKUP_DIR: backupDir,
        RETENTION_MINUTES: "5",
        PATH: `${fakeBinDir}${path.delimiter}${process.env.PATH}`,
      },
      encoding: "utf8",
    });

    expect(existsSync(staleFile)).toBe(false);

    const remaining: string[] = readdirSync(backupDir).filter((f: string) => f.endsWith(".sql"));
    // The fresh dump this same run just created should survive its own
    // 5-minute retention window.
    expect(remaining.length).toBeGreaterThan(0);
  }, 30_000);

  it("fails with a clear error when DATABASE_URL is unset", () => {
    expect(() =>
      execFileSync("bash", [BACKUP_SCRIPT], {
        cwd: REPO_ROOT,
        env: {
          ...process.env,
          DATABASE_URL: "",
          BACKUP_DIR: backupDir,
          PATH: `${fakeBinDir}${path.delimiter}${process.env.PATH}`,
        },
        encoding: "utf8",
      }),
    ).toThrow();
  });
});
