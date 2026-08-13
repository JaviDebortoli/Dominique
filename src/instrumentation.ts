// Next.js instrumentation hook (stable since Next 15, no experimental flag
// needed) — `register()` runs exactly once per server process start. This
// is the D6 wiring point for the expiry sweep's node-cron registration
// (tasks.md 6.5): PM2 (deploy/ecosystem.config.js, Phase 8) runs a single
// `next start` process, no cluster mode, so this fires exactly once and the
// in-process cron job is the only sweep running — no leader election
// needed (design.md D6).
//
// Guarded to the nodejs runtime only: `register()` also runs for the Edge
// runtime bundle, which cannot load node-cron/pg (Node.js-only APIs).
export async function register(): Promise<void> {
  if (process.env.NEXT_RUNTIME === "nodejs") {
    const { scheduleExpireReservationsSweep } = await import("@/jobs/expire-reservations");
    scheduleExpireReservationsSweep();
  }
}
