# Deploying Dominique to a DonWeb Cloud Server (VPS)

This is a step-by-step runbook for deploying this app to a DonWeb Cloud
Server/VPS with root/SSH access. It assumes you can run shell commands over
SSH but does not assume prior DevOps experience — every command is spelled
out. If you get stuck on a step, re-read its "What this does" note before
moving on.

Architecture recap (see `openspec/changes/dominique-ecommerce/design.md`
"Technical Approach" for the full rationale): one Next.js process, managed
by **PM2**, sitting behind **Nginx** (reverse proxy + static file serving +
rate limiting), with **Certbot** issuing/renewing the HTTPS certificate.
PostgreSQL is the only other service — no Redis, no queue, no separate
worker process.

---

## 0. Before you start

You will need:

- Root or sudo SSH access to the DonWeb VPS.
- A domain name pointed at the VPS's public IP (an `A` record). Certbot
  cannot issue a certificate for a domain that doesn't resolve to this
  server yet — set the DNS record first and let it propagate (can take up
  to a few hours) before step 8.
- Your MercadoPago production credentials (Access Token + webhook secret)
  from https://www.mercadopago.com.ar/developers — see `.env.example` for
  exactly which two values and where to find them.
- Enough disk space for Postgres data + nightly backups (a few GB is
  comfortable for this app's scale).

---

## 1. Provision the VPS

SSH in as root (or a sudo user):

```bash
ssh root@YOUR_SERVER_IP
```

Update the system and install the base tools:

```bash
apt update && apt upgrade -y
apt install -y curl git ufw
```

### 1a. Firewall (ufw)

Only allow SSH, HTTP, and HTTPS from the outside — everything else
(Postgres, the Next.js process itself) stays bound to localhost and is
never directly reachable from the internet:

```bash
ufw allow OpenSSH
ufw allow 80/tcp
ufw allow 443/tcp
ufw enable
ufw status
```

### 1b. Node.js

Install Node.js 22 (matches this repo's `@types/node: ^20` floor and
current LTS — anything ≥20 works; use nvm if you'd rather manage versions
per-project):

```bash
curl -fsSL https://deb.nodesource.com/setup_22.x | bash -
apt install -y nodejs
node -v   # sanity check
```

### 1c. PostgreSQL

```bash
apt install -y postgresql postgresql-contrib
systemctl enable --now postgresql
```

Create the database and a dedicated app user (replace `CHOOSE_A_STRONG_PASSWORD`):

```bash
sudo -u postgres psql -c "CREATE USER dominique WITH PASSWORD 'CHOOSE_A_STRONG_PASSWORD';"
sudo -u postgres psql -c "CREATE DATABASE dominique OWNER dominique;"
```

By default Postgres only listens on localhost and authenticates local
connections via `peer`/`md5` — good, the app connects over
`localhost:5432`, and nothing external ever touches Postgres directly (the
firewall in step 1a doesn't even open port 5432).

### 1d. Nginx and Certbot

```bash
apt install -y nginx certbot python3-certbot-nginx
systemctl enable --now nginx
```

### 1e. PM2

```bash
npm install -g pm2
```

---

## 2. Clone the repo and install dependencies

Pick a release directory convention that makes rollback easy (step 12 relies
on this): a versioned/timestamped directory with a `current` symlink
pointing at the active one.

```bash
mkdir -p /var/dominique/releases
cd /var/dominique/releases
git clone <YOUR_REPO_URL> $(date -u +%Y%m%dT%H%M%SZ)
cd <the directory git just created>
ln -sfn "$(pwd)" /var/dominique/releases/current
```

Install exact locked dependencies and build:

```bash
cd /var/dominique/releases/current
npm ci
```

(`npm run build` happens in step 6, after `.env` and the DB are ready —
Next.js's build step touches the database for statically-prerendered
pages, so `.env`/`DATABASE_URL` must exist first.)

---

## 3. Product image uploads directory (design.md D8)

Create the directory Nginx will serve uploads from directly (see
`deploy/nginx.conf`'s `/uploads/` `alias` block) and give the app user
write access:

```bash
mkdir -p /var/dominique/uploads/products
chown -R www-data:www-data /var/dominique/uploads
```

(If you run the Node process as a different system user than `www-data`,
`chown` to that user instead — whoever PM2 runs the app as needs write
access here.)

---

## 4. Configure environment variables

Copy the example file and fill in real values:

```bash
cd /var/dominique/releases/current
cp .env.example .env
nano .env   # or vim/whatever editor is installed
```

Fill in, at minimum:

- `DATABASE_URL` — `postgresql://dominique:CHOOSE_A_STRONG_PASSWORD@localhost:5432/dominique?schema=public` (the user/password from step 1c).
- `MP_ACCESS_TOKEN` / `MP_WEBHOOK_SECRET` — production values from MercadoPago (see `.env.example`'s comments for exactly where to get these).
- `NEXT_PUBLIC_BASE_URL` — your real HTTPS domain, e.g. `https://dominique.example.com` (must match what you'll issue the certificate for in step 8 — MercadoPago will call this URL for webhooks, and it cannot be `localhost`).
- `AUTH_SECRET` — generate a fresh one for this environment, never reuse the repo's dev value:
  ```bash
  node -e "console.log(require('crypto').randomBytes(32).toString('base64'))"
  ```
- `UPLOAD_DIR` — set this to `/var/dominique/uploads` (the directory from step 3). **This is what points the app at the real production upload path instead of the local-dev default (`public/uploads/products`)** — see `.env.example`'s comment on this var and `app/api/admin/upload/route.ts`'s module doc for the full rationale. The URL returned to browsers is always `/uploads/products/<name>` either way; only the on-disk write location changes, and `deploy/nginx.conf`'s `/uploads/` alias is what actually serves files from `/var/dominique/uploads` in production.

Leave `ADMIN_SEED_EMAIL`/`ADMIN_SEED_PASSWORD` commented out unless you're
about to run step 5's seed step to provision the real first admin account —
see that section and `.env.example`'s comments for the full rotation
procedure.

---

## 5. Run migrations and seed

```bash
cd /var/dominique/releases/current
npx prisma migrate deploy
```

This applies every migration in `prisma/migrations/` in order — safe to
re-run (it no-ops for already-applied migrations), which is exactly what
makes it safe to run again on every future deploy too.

**Seeding**: `prisma/seed.ts`'s catalog/store-hours fixtures are dev-only —
do NOT run a bare `npm run db:seed` in production, it will create sample
products. The one part of the seed script you DO want in production is
`seedAdminUser()`, to provision the real first admin login. To run only
that safely:

```bash
ADMIN_SEED_EMAIL="owner@dominique-real-domain.com" \
ADMIN_SEED_PASSWORD="choose-a-strong-unique-password" \
npm run db:seed
```

With those two env vars set, `seedAdminUser()` bcrypt-hashes
`ADMIN_SEED_PASSWORD` and upserts that admin account instead of creating
the dev fixture (`admin@dominique.local`) — see `.env.example`'s comments
for the full explanation. **This still runs the rest of the seed script
too** (catalog/store-hours fixtures) — if you don't want sample products in
production, add your real `Category`/`Product`/`Variant` rows through the
admin console (`/admin/productos/nuevo`) once you're logged in instead, and
only ever use this seed invocation for the one-time admin bootstrap.

Immediately after, unset those two env vars (don't leave them in `.env`) so
a later `db:seed` run doesn't silently re-provision:

```bash
# Make sure ADMIN_SEED_EMAIL/ADMIN_SEED_PASSWORD are NOT left in .env.
grep ADMIN_SEED .env   # should print nothing (or only commented-out lines)
```

---

## 6. Build

```bash
cd /var/dominique/releases/current
npm run build
```

This produces the `.next/` production build that `next start` (step 7)
serves. If this step fails, do not proceed — fix the build error first
(check `.env` is complete and the database is reachable; `npm run build`
touches the DB for statically-prerendered pages like the home page).

---

## 7. Start the app with PM2

```bash
cd /var/dominique/releases/current
pm2 start deploy/ecosystem.config.js
pm2 save
pm2 startup   # follow the printed instructions to enable PM2 on boot
```

**Do not change `instances` in `deploy/ecosystem.config.js` from `1`, and
do not switch it to cluster mode.** See that file's own module doc for why:
the expiry-reservation sweep (`src/jobs/expire-reservations.ts`, design.md
D6) runs as an in-process `node-cron` job started once per Node process —
running more than one instance means running that sweep concurrently more
than once, which design.md D6 explicitly chose to avoid rather than pay for
leader-election coordination.

Verify it's actually up:

```bash
pm2 status
pm2 logs dominique --lines 50
curl -sI http://127.0.0.1:3000/   # should return HTTP/1.1 200
```

---

## 8. Nginx site config + Certbot

Copy the config and point it at your real domain:

```bash
cp /var/dominique/releases/current/deploy/nginx.conf /etc/nginx/sites-available/dominique.conf
sed -i 's/dominique.example.com/YOUR_REAL_DOMAIN/g' /etc/nginx/sites-available/dominique.conf
ln -sfn /etc/nginx/sites-available/dominique.conf /etc/nginx/sites-enabled/dominique.conf
# Remove Nginx's default site if it's still enabled and would conflict:
rm -f /etc/nginx/sites-enabled/default
mkdir -p /var/www/certbot   # Certbot's HTTP-01 challenge directory
nginx -t                    # validates syntax BEFORE reloading
systemctl reload nginx
```

Confirm the rate-limit zones are actually active (design.md Threat Matrix
"Untrusted webhook intake", and 2026-08-21-checkout-antiabuso's checkout +
admin-login zones):

```bash
nginx -T | grep limit_req_zone
# expect all three:
#   limit_req_zone $binary_remote_addr zone=mp_webhook:10m rate=5r/s;
#   limit_req_zone $binary_remote_addr zone=checkout:10m rate=20r/m;
#   limit_req_zone $admin_login_limit_key zone=admin_login:10m rate=5r/m;
```

### Manual verification — checkout and admin-login rate limits (2026-08-21-checkout-antiabuso, tasks.md 2.6)

No automated harness exists for Nginx config — this is the runbook step
that stands in for one:

```bash
nginx -t
# expect: syntax is ok / test is successful

nginx -T | grep limit_req_zone
# expect the three zones shown above (mp_webhook, checkout, admin_login)

# 21st POST to /api/checkout within the same minute from one IP -> 429
for i in $(seq 1 21); do
  curl -s -o /dev/null -w "%{http_code}\n" -X POST https://YOUR_REAL_DOMAIN/api/checkout \
    -H "content-type: application/json" -d '{}'
done
# expect: the first 20 responses are NOT 429 (whatever the app itself
# returns for an invalid/empty body — 400, not 429); the 21st is 429

# A plain GET to /admin/login is never throttled (only POST is keyed by the
# $admin_login_limit_key map above):
for i in $(seq 1 10); do
  curl -s -o /dev/null -w "%{http_code}\n" https://YOUR_REAL_DOMAIN/admin/login
done
# expect: every response is 200, never 429
```

At this point `http://YOUR_REAL_DOMAIN` should already proxy to the app
(no HTTPS yet). Now issue the certificate:

```bash
certbot --nginx -d YOUR_REAL_DOMAIN
```

Certbot will ask for an email (for renewal-failure notices) and offer to
redirect HTTP→HTTPS automatically — accept that. It rewrites
`/etc/nginx/sites-available/dominique.conf` in place to add the `listen 443
ssl` block and reloads Nginx for you. Confirm:

```bash
curl -sI https://YOUR_REAL_DOMAIN/   # should return HTTP/2 200
```

### Certbot renewal (task 8.4)

Certbot's Debian/Ubuntu package installs its own systemd timer
(`certbot.timer`) — or a cron job on older systems — that runs `certbot
renew` twice a day automatically; it only actually renews when a
certificate is within 30 days of expiring, so this is safe to leave running
indefinitely with no manual action. Confirm it's active:

```bash
systemctl list-timers | grep certbot
# or, on systems without the timer, check for the cron job instead:
cat /etc/cron.d/certbot 2>/dev/null
```

If neither exists (unusual, but possible on a minimal image), add the
systemd timer's equivalent yourself as a daily cron job:

```bash
echo "0 3 * * * root certbot renew --quiet --deploy-hook 'systemctl reload nginx'" \
  > /etc/cron.d/dominique-certbot-renew
```

The `--deploy-hook` reloads Nginx only when a renewal actually happened
(picking up the new cert), not on every no-op check. You can dry-run the
whole renewal path without waiting for expiry:

```bash
certbot renew --dry-run
```

---

## 9. Set up nightly backups

`deploy/backup.sh` runs `pg_dump` and prunes old dumps (default retention:
14 days — see that file's header comment for the env vars that override
this). Install `postgresql-client` if you didn't already get it as a
dependency of the full `postgresql` package in step 1c:

```bash
which pg_dump || apt install -y postgresql-client
mkdir -p /var/backups/dominique
```

Add a nightly cron job (03:00 local time — adjust as you like):

```bash
cat > /etc/cron.d/dominique-backup <<'EOF'
0 3 * * * root DATABASE_URL="postgresql://dominique:CHOOSE_A_STRONG_PASSWORD@localhost:5432/dominique?schema=public" /var/dominique/releases/current/deploy/backup.sh >> /var/log/dominique/backup.log 2>&1
EOF
mkdir -p /var/log/dominique
```

Use the SAME `DATABASE_URL` value you put in `.env` in step 4. Test it
manually once before trusting the cron job:

```bash
DATABASE_URL="postgresql://dominique:CHOOSE_A_STRONG_PASSWORD@localhost:5432/dominique?schema=public" \
  /var/dominique/releases/current/deploy/backup.sh
ls -la /var/backups/dominique
```

You should see a file named `dominique-<UTC timestamp>.sql`.

---

## 10. Verify the app is live end-to-end

- Visit `https://YOUR_REAL_DOMAIN/` in a browser — the home page should
  load with real categories/products (once you've added them via the admin
  console or the production seed step).
- Visit `https://YOUR_REAL_DOMAIN/admin/login` and log in with the admin
  account you provisioned in step 5.
- `pm2 status` shows `dominique` as `online`, restart count not climbing.
- `pm2 logs dominique` shows no repeated errors.
- Place a real (or MercadoPago sandbox, if testing before going live) test
  order and confirm the webhook round-trips: `pm2 logs dominique | grep
  webhooks` should show the POST being received and processed.

---

## 11. Deploying a new release later

Repeat steps 2 (clone into a NEW timestamped directory), 4 (copy `.env`
from the previous release directory — don't regenerate secrets), 5
(`prisma migrate deploy` — safe/idempotent), and 6 (`npm run build`), then:

```bash
ln -sfn /var/dominique/releases/<new-timestamped-dir> /var/dominique/releases/current
pm2 restart dominique
```

Take a manual backup (step 9's command) immediately before this, in
addition to the nightly cron — cheap insurance right before a migration.

---

## 12. Rollback procedure

If a release goes bad (per design.md "Migration/Rollout": "rollback =
repoint Nginx to the previous release dir + restore last `pg_dump`"):

1. **Repoint to the previous release directory:**
   ```bash
   ln -sfn /var/dominique/releases/<previous-timestamped-dir> /var/dominique/releases/current
   cd /var/dominique/releases/current
   pm2 restart dominique
   ```
   PM2's process definition (`deploy/ecosystem.config.js`) uses `cwd:
   __dirname + "/.."` resolved from wherever `pm2 start` was originally run
   — if `current` is a symlink PM2 already resolved at start time, a
   `pm2 restart` reuses the ORIGINAL resolved path, not a re-resolution of
   the symlink. To be certain the previous release's build/code is what
   actually starts, delete and re-start the process pointed at the new
   symlink target instead of trusting `restart` alone:
   ```bash
   pm2 delete dominique
   cd /var/dominique/releases/current   # now pointing at the previous release
   pm2 start deploy/ecosystem.config.js
   pm2 save
   ```

2. **Restore the last known-good backup**, if the bad release also wrote
   bad data (skip this if the rollback is purely code/config and the data
   is still fine):
   ```bash
   ls -la /var/backups/dominique   # pick the dump from before the bad release
   sudo -u postgres psql -c "DROP DATABASE dominique;"
   sudo -u postgres psql -c "CREATE DATABASE dominique OWNER dominique;"
   sudo -u postgres psql -d dominique -f /var/backups/dominique/dominique-<TIMESTAMP>.sql
   ```
   This is destructive — it drops and replaces the whole database. Only do
   this when the current data is genuinely bad, not for a pure code
   rollback.

3. **Confirm Nginx still points at the right thing** — it doesn't need any
   change for a code/PM2 rollback (Nginx always proxies to
   `127.0.0.1:3000`; only which process is listening there changes), but
   re-run `curl -sI https://YOUR_REAL_DOMAIN/` to confirm the app responds.

---

## Local development (for context — not part of this deploy runbook)

See the repo root `README.md` for `npm run dev`/`npm run test` against a
local Postgres instance. This file is production-deployment-only.
