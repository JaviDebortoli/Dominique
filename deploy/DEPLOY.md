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
npx prisma generate
```

`npx prisma generate` creates the Prisma client in `src/generated/prisma`.
That directory is gitignored, so a fresh clone does not have it, and both
the seed script (step 5) and `npm run build` (step 6) fail without it. Run
it again after every `npm ci` on a new release (step 11).

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
- `NEXT_PUBLIC_BASE_URL` — your real HTTPS domain, e.g. `https://dominique.example.com` (must match what you'll issue the certificate for in step 8 — MercadoPago will call this URL for webhooks, and it cannot be `localhost`). Until a domain exists you can temporarily use `http://<server-ip>`. This value is inlined at build time, so changing it later requires a new `npm run build` and `pm2 restart dominique`.
- `AUTH_SECRET` — generate a fresh one for this environment, never reuse the repo's dev value:
  ```bash
  node -e "console.log(require('crypto').randomBytes(32).toString('base64'))"
  ```
- `UPLOAD_DIR` — set this to `/var/dominique/uploads` (the directory from step 3). **This is what points the app at the real production upload path instead of the local-dev default (`public/uploads/products`)** — see `.env.example`'s comment on this var and `app/api/admin/upload/route.ts`'s module doc for the full rationale. The URL returned to browsers is always `/uploads/products/<name>` either way; only the on-disk write location changes, and `deploy/nginx.conf`'s `/uploads/` alias is what actually serves files from `/var/dominique/uploads` in production.

Notes on writing `.env` safely:

- If you create the file from the shell instead of an editor, use a quoted
  heredoc (`<<'EOF'`) so characters such as `$` in passwords are not
  expanded by the shell:
  ```bash
  cat > .env <<'EOF'
  DATABASE_URL="postgresql://dominique:PASSWORD@localhost:5432/dominique?schema=public"
  # ...the other variables...
  EOF
  ```
- URL-encode special characters in the database password inside
  `DATABASE_URL` (for example `@` becomes `%40`, `/` becomes `%2F`,
  `:` becomes `%3A`, `?` becomes `%3F`, `#` becomes `%23`). Avoiding
  special characters in the DB password is simpler still.
- Restrict the file, since it holds secrets: `chmod 600 .env`.
- Keep `?schema=public` in `DATABASE_URL`: Prisma needs it. `psql` and
  `pg_dump` (libpq) reject it with `invalid URI query parameter: "schema"`,
  so for those tools use the URL with the suffix removed.

Check that the database is reachable with the credentials in `.env`
(this strips `?schema=public` for `psql`):

```bash
psql "$(grep DATABASE_URL .env | cut -d'"' -f2 | sed 's/?schema=public//')" -c 'select 1'
```

It should print a one-row result with the value `1`.

Leave `ADMIN_SEED_EMAIL`/`ADMIN_SEED_PASSWORD` out of `.env`: step 5 passes
them on the command line for the one-time admin bootstrap instead.

---

## 5. Run migrations and seed

```bash
cd /var/dominique/releases/current
npx prisma migrate deploy
```

This applies every migration in `prisma/migrations/` in order — safe to
re-run (it no-ops for already-applied migrations), which is exactly what
makes it safe to run again on every future deploy too.

**Seeding**: `prisma/seed.ts` (`npm run db:seed`) loads dev-only catalog
fixtures and, without `ADMIN_SEED_*`, a fixture admin — do NOT run it in
production. Use the admin-only bootstrap instead: `npm run db:seed:admin`
(`prisma/seed-admin.ts`) runs only the store hours and the admin account,
with no catalog fixtures, and exits with an error if `ADMIN_SEED_EMAIL` or
`ADMIN_SEED_PASSWORD` is missing, so it can never create the dev fixture
admin (`admin@dominique.local`).

```bash
cd /var/dominique/releases/current
ADMIN_SEED_EMAIL="owner@dominique-real-domain.com" \
ADMIN_SEED_PASSWORD='choose-a-strong-unique-password' \
npm run db:seed:admin
```

Use single quotes around the password and do not put a single quote inside
it. The script bcrypt-hashes the password and upserts the admin by email.
Add your real `Category`/`Product`/`Variant` rows through the admin console
(`/admin/productos/nuevo`) once you're logged in.

Verify the admin exists (the table is `admin_users`; the Prisma model
`AdminUser` is mapped to it with `@@map`). Use the same stripped URL as in
step 4:

```bash
psql "$(grep DATABASE_URL .env | cut -d'"' -f2 | sed 's/?schema=public//')" -c 'SELECT email FROM admin_users;'
```

To rotate the password, re-run the same command with the same
`ADMIN_SEED_EMAIL` and a new `ADMIN_SEED_PASSWORD`. There is no in-app
password-change UI, so this is the only way to change it.

Keep `ADMIN_SEED_*` out of `.env` (they are passed on the command line
above) so a later seed run doesn't silently re-provision:

```bash
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
mkdir -p /var/log/dominique   # PM2 writes its logs here; it must exist first
pm2 start deploy/ecosystem.config.cjs
pm2 save
pm2 startup   # follow the printed instructions to enable PM2 on boot
```

The PM2 config is a `.cjs` file because this repo's `package.json` has
`"type": "module"`, which makes a plain `.js` file an ES module; the config
uses `module.exports` and `__dirname`, which only work in CommonJS.

**Do not change `instances` in `deploy/ecosystem.config.cjs` from `1`, and
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

### IP-only (no domain yet)

If you do not have a domain yet, you can still put Nginx in front of the
app using the server IP:

- Use the server IP as `server_name` (in the `sed` below, replace
  `YOUR_REAL_DOMAIN` with the IP) and use `http://<server-ip>` in the
  verification commands instead of `https://YOUR_REAL_DOMAIN`.
- Skip Certbot: certificates cannot be issued for a bare IP address.
- MercadoPago webhooks require HTTPS, so online payments must wait until a
  domain and certificate exist.

To switch to a domain later: create the DNS `A` record, replace the IP in
`server_name` with the domain in `/etc/nginx/sites-available/dominique.conf`
(`nginx -t && systemctl reload nginx`), run `certbot --nginx -d
YOUR_REAL_DOMAIN`, set `NEXT_PUBLIC_BASE_URL` in `.env` to
`https://YOUR_REAL_DOMAIN`, then run `npm run build` and
`pm2 restart dominique`.

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
mkdir -p /var/log/dominique
cat > /etc/cron.d/dominique-backup <<'EOF'
0 3 * * * root DATABASE_URL="$(grep DATABASE_URL /var/dominique/releases/current/.env | cut -d'"' -f2)" bash /var/dominique/releases/current/deploy/backup.sh >> /var/log/dominique/backup.log 2>&1
EOF
```

The job reads `DATABASE_URL` from the release's `.env`, so the password is
not duplicated in the cron file. `backup.sh` strips the `?schema=public`
suffix itself (libpq rejects it) and never writes the password to its log.
It is invoked with `bash` so the file's exec bit does not matter. Test it
manually once before trusting the cron job:

```bash
DATABASE_URL="$(grep DATABASE_URL /var/dominique/releases/current/.env | cut -d'"' -f2)" \
  bash /var/dominique/releases/current/deploy/backup.sh
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
(`prisma migrate deploy` — safe/idempotent), and 6 (`npm run build`).
In the new directory, run `npm ci` and `npx prisma generate` (step 2)
BEFORE `npm run build`: the generated client is gitignored, so each fresh
clone needs it. Skip the admin seed (it was a one-time bootstrap). Then:

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
   PM2's process definition (`deploy/ecosystem.config.cjs`) uses `cwd:
   __dirname + "/.."` resolved from wherever `pm2 start` was originally run
   — if `current` is a symlink PM2 already resolved at start time, a
   `pm2 restart` reuses the ORIGINAL resolved path, not a re-resolution of
   the symlink. To be certain the previous release's build/code is what
   actually starts, delete and re-start the process pointed at the new
   symlink target instead of trusting `restart` alone:
   ```bash
   pm2 delete dominique
   cd /var/dominique/releases/current   # now pointing at the previous release
   pm2 start deploy/ecosystem.config.cjs
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
