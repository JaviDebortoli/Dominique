// PM2 process definition for Dominique (tasks.md 8.2, design.md "Technical
// Approach": "One Next.js process on a DonWeb VPS: PM2 → Nginx → Certbot").
//
// Usage (see deploy/DEPLOY.md for the full runbook):
//   npm ci && npm run build
//   pm2 start deploy/ecosystem.config.js
//   pm2 save && pm2 startup   # persist across VPS reboots
//
// D6 — instances MUST stay 1, cluster mode MUST stay off:
// src/instrumentation.ts's register() hook schedules the expiry-sweep
// node-cron job (src/jobs/expire-reservations.ts) exactly once per Node
// PROCESS start. PM2 cluster mode (`exec_mode: "cluster"` with
// `instances > 1`) forks N independent Node processes behind PM2's
// round-robin balancer — each one would run its own `register()` call and
// its own in-process cron schedule, so the sweep would run N times
// concurrently every 15 minutes. The sweep's own transaction re-check
// (see expire-reservations.ts's module doc) would prevent DOUBLE-RELEASING
// stock, but it does NOT prevent the wasted concurrent DB work, and design.md
// D6 explicitly chose "single instance, so no leader election needed" over
// paying for that coordination. Keep this at exactly 1 unless the sweep is
// first extracted to its own leader-elected process or an external
// scheduler (systemd timer / pg_cron) — that would be a design change, not
// a config tweak.
module.exports = {
  apps: [
    {
      name: "dominique",
      cwd: __dirname + "/..",
      script: "npm",
      args: "run start",
      // D6 (see module doc above): exactly one instance, fork mode (PM2's
      // default when `exec_mode` is omitted) — never "cluster", never > 1.
      instances: 1,
      exec_mode: "fork",
      // `npm run start` runs `next start`, which serves the build produced
      // by `npm run build` (DEPLOY.md step 9) — this process does NOT
      // build on its own; a stale/missing .next/ directory will fail to
      // start, which is intentional (build failures should be caught in
      // CI/deploy, not silently retried by PM2).
      //
      // No `env_file` entry here: Next.js's own runtime already loads
      // `.env`/`.env.production` from `cwd` for both `next build` and
      // `next start` (this is built into Next, not something this repo's
      // `dotenv` dependency does — that one is only for standalone Node
      // scripts like `prisma/seed.ts` that run outside Next's runtime).
      // DEPLOY.md walks through creating a real `.env` in the app's
      // release directory before the first `pm2 start`.
      env: {
        NODE_ENV: "production",
      },
      // Modest safety net: if the process crashes, restart it, but don't
      // hot-loop forever on a genuinely broken deploy.
      autorestart: true,
      max_restarts: 10,
      min_uptime: "30s",
      // Keep PM2's own logs bounded and out of the repo.
      out_file: "/var/log/dominique/out.log",
      error_file: "/var/log/dominique/error.log",
      time: true,
    },
  ],
};
