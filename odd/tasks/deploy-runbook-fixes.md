# Feature: Deploy runbook fixes (first real VPS deploy findings)

## Objective
Make `deploy/` (runbook, backup script, PM2 config) work as written on the real DonWeb VPS, fixing every gap found during the first production deploy.

## Problem / Why
Following `deploy/DEPLOY.md` literally on the VPS failed or misled in several places:
- `backup.sh` passes `DATABASE_URL` (with Prisma's `?schema=public`) to `pg_dump`; libpq rejects it (`invalid URI query parameter: "schema"`), so the nightly backup silently fails. The test suite uses a fake `pg_dump` that does not reproduce libpq's URI validation, so the bug went unnoticed. The script also echoes the URL including the password into the backup log.
- `deploy/ecosystem.config.js` uses `module.exports` but `package.json` is `"type": "module"`, so PM2 may refuse to load it.
- PM2 logs go to `/var/log/dominique/`, which the runbook only creates later (step 9).
- `src/generated/prisma` is gitignored and nothing runs `prisma generate`; seed and build fail without it.
- `npm run db:seed` always loads dev catalog fixtures; the runbook has no admin-only bootstrap path.
- Runbook lacks: IP-only (no domain yet) Nginx path, the real table name (`admin_users`), a DB connectivity check that works with `psql`.

## Scope (authorized)
- `backup.sh`: strip query parameters before calling `pg_dump`; never log the password. Tests prove both.
- PM2 config renamed to `deploy/ecosystem.config.cjs`; all references updated.
- `DEPLOY.md`: `prisma generate` step, `/var/log/dominique` created before PM2, admin-only bootstrap (store hours + admin, no fixtures), cron reading `DATABASE_URL` from `.env`, IP-only Nginx note (skip Certbot until a domain exists), `psql` check without `?schema=`, `admin_users` table name for admin maintenance.
- Out of scope: off-site backups, admin password change UI, MercadoPago setup.

## Constraints
- Artifacts in English. Keep the runbook's existing structure and section numbering.
- `.env` keeps `?schema=public` (Prisma needs it).

## TDD
- Mode: enabled. Source: `openspec/config.yaml` (`tdd: true`). Runner: `npm test` (vitest).

## Delivery
- Branch: `fix/deploy-runbook` (from `main`). Strategy: `ask-on-risk`. Forecast: ~200 authored changed lines.

## Tasks
- [x] T1 — `backup.sh` strips URI query params before `pg_dump` and redacts the password in its log line; fake `pg_dump` rejects unknown URI params like libpq; tests cover both.
- [x] T2 — Rename PM2 config to `deploy/ecosystem.config.cjs`; update references.
- [ ] T3 — `DEPLOY.md` corrections listed in Scope.

## Route per task
- Delegated direct (writer trigger: 2+ non-trivial files).

## Acceptance criteria
- `backup.sh` with a `?schema=public` URL produces a dump; its output never contains the password.
- PM2 starts from `deploy/ecosystem.config.cjs`.
- A fresh deploy following `DEPLOY.md` step by step needs no undocumented commands.

## Checks
- `npm test`, `npm run lint`, `npx tsc --noEmit`.

## Progress
- Created 2026-10-11. T1 done (commit 179c088; RED: 4 backup tests failed with `invalid URI query parameter` before the fix; GREEN: deploy suite 5/5). T2 done. Next: T3.
