import { afterEach, describe, expect, it, vi } from "vitest";

// tasks.md 6.5, smoke-level (per apply-progress guidance: prove the sweep
// is WIRED into the server startup hook, not a full 15-minute wait). Backs
// design.md D6's "node-cron inside the PM2 process" — this instrumentation
// hook is the single place that registration happens.
describe("instrumentation — register() wires the expiry sweep on server startup (task 6.5)", () => {
  const originalRuntime = process.env.NEXT_RUNTIME;

  afterEach(() => {
    process.env.NEXT_RUNTIME = originalRuntime;
    vi.doUnmock("@/jobs/expire-reservations");
    vi.resetModules();
  });

  it("schedules the sweep when running under the nodejs runtime", async () => {
    process.env.NEXT_RUNTIME = "nodejs";
    const scheduleExpireReservationsSweep = vi.fn();
    vi.doMock("@/jobs/expire-reservations", () => ({ scheduleExpireReservationsSweep }));

    const { register } = await import("./instrumentation");
    await register();

    expect(scheduleExpireReservationsSweep).toHaveBeenCalledTimes(1);
  });

  it("does NOT schedule the sweep outside the nodejs runtime (e.g. edge)", async () => {
    process.env.NEXT_RUNTIME = "edge";
    const scheduleExpireReservationsSweep = vi.fn();
    vi.doMock("@/jobs/expire-reservations", () => ({ scheduleExpireReservationsSweep }));

    const { register } = await import("./instrumentation");
    await register();

    expect(scheduleExpireReservationsSweep).not.toHaveBeenCalled();
  });
});
