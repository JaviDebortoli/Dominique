import { describe, expect, it } from "vitest";
import { authConfig } from "./auth.config";

// docs/bugs.md "Problemas ahora": admin session never expires on its own
// (30-day Auth.js default). A hard "logout on tab close" isn't achievable
// without disabling Auth.js's own session-refresh cookie write, so the
// resolved fix is a bounded idle timeout instead (owner decision: 8h).
describe("authConfig.session", () => {
  it("uses the jwt strategy", () => {
    expect(authConfig.session?.strategy).toBe("jwt");
  });

  it("expires an idle admin session after 8 hours, not the 30-day default", () => {
    const EIGHT_HOURS_IN_SECONDS = 8 * 60 * 60;
    expect(authConfig.session?.maxAge).toBe(EIGHT_HOURS_IN_SECONDS);
  });
});
