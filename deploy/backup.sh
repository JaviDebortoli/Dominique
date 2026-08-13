#!/usr/bin/env bash
# Nightly Postgres backup for Dominique (tasks.md 8.3, design.md
# "Migration/Rollout": "rollback = repoint Nginx to the previous release
# dir + restore last pg_dump"). Intended to run as a cron job / systemd
# timer on the DonWeb VPS (see deploy/DEPLOY.md's backup step) — NOT a PM2
# app (this is a one-shot job, not a long-running server process).
#
# Requires `pg_dump` on PATH (installed alongside PostgreSQL — see
# DEPLOY.md's provisioning step, `apt install postgresql-client`) and
# DATABASE_URL set in the environment (source the app's .env, or export it
# directly in the cron/systemd-timer unit's environment).
#
# Usage:
#   DATABASE_URL=postgres://user:pass@host:5432/db ./backup.sh
#
# Optional env overrides:
#   BACKUP_DIR        Where dumps are written (default: /var/backups/dominique)
#   RETENTION_DAYS     Prune dumps older than this many days (default: 14)
#   RETENTION_MINUTES  Overrides RETENTION_DAYS in minutes — mainly for
#                       tests (deploy/backup.test.ts) that need a fast,
#                       deterministic pruning window; real deploys should
#                       leave this unset and use RETENTION_DAYS instead.
set -euo pipefail

BACKUP_DIR="${BACKUP_DIR:-/var/backups/dominique}"
RETENTION_DAYS="${RETENTION_DAYS:-14}"
RETENTION_MINUTES="${RETENTION_MINUTES:-$((RETENTION_DAYS * 24 * 60))}"

if [ -z "${DATABASE_URL:-}" ]; then
  echo "backup.sh: DATABASE_URL is not set" >&2
  exit 1
fi

if ! command -v pg_dump >/dev/null 2>&1; then
  echo "backup.sh: pg_dump not found on PATH — install postgresql-client (see deploy/DEPLOY.md)" >&2
  exit 1
fi

mkdir -p "$BACKUP_DIR"

timestamp="$(date -u +%Y%m%dT%H%M%SZ)"
dump_file="$BACKUP_DIR/dominique-${timestamp}.sql"

echo "backup.sh: dumping ${DATABASE_URL%%\?*} -> ${dump_file}"
pg_dump "$DATABASE_URL" --no-owner --no-privileges --format=plain -f "$dump_file"

if [ ! -s "$dump_file" ]; then
  echo "backup.sh: dump file is empty — treating as a failed backup" >&2
  rm -f "$dump_file"
  exit 1
fi

echo "backup.sh: pruning dumps older than ${RETENTION_MINUTES} minutes in ${BACKUP_DIR}"
find "$BACKUP_DIR" -maxdepth 1 -type f -name 'dominique-*.sql' -mmin "+${RETENTION_MINUTES}" -print -delete

echo "backup.sh: done -> ${dump_file}"
