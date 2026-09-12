import { describe, expect, it } from "vitest";
import { resolveArgentinaDayStart, resolveReportRange } from "./report-day";

// control-de-caja tasks.md 5.1 — design.md D5: fixed UTC−3 day boundaries
// for the revenue report (business-days.ts's UTC-as-wall-clock shortcut is
// NOT reused here — a financial day-close cannot tolerate that drift).
describe("report-day — resolveArgentinaDayStart()", () => {
  it("resolves a YYYY-MM-DD string to Date.UTC(y, m, d, 3, 0, 0) — 03:00Z is midnight in Argentina (UTC−3)", () => {
    const result = resolveArgentinaDayStart("2026-09-10");

    expect(result.toISOString()).toBe("2026-09-10T03:00:00.000Z");
  });

  it("triangulation: a different date resolves to its own 03:00Z instant", () => {
    const result = resolveArgentinaDayStart("2026-01-01");

    expect(result.toISOString()).toBe("2026-01-01T03:00:00.000Z");
  });
});

describe("report-day — resolveReportRange() (tasks.md 5.1: the 21:30-ART-is-next-UTC-day case)", () => {
  it("a single day's range is [that day's 03:00Z, next day's 03:00Z) — half-open", () => {
    const range = resolveReportRange({ from: "2026-09-10", to: "2026-09-10" });

    expect(range.from.toISOString()).toBe("2026-09-10T03:00:00.000Z");
    expect(range.to.toISOString()).toBe("2026-09-11T03:00:00.000Z");
  });

  it("21:30 ART on 2026-09-10 (00:30 UTC on 2026-09-11, a DIFFERENT UTC calendar day) still falls inside the 2026-09-10 single-day range", () => {
    const range = resolveReportRange({ from: "2026-09-10", to: "2026-09-10" });
    const saleAt2130Art = new Date("2026-09-11T00:30:00.000Z");

    expect(saleAt2130Art.getTime()).toBeGreaterThanOrEqual(range.from.getTime());
    expect(saleAt2130Art.getTime()).toBeLessThan(range.to.getTime());
  });

  it("a multi-day range spans from the start day's 03:00Z to the day AFTER the end day's 03:00Z", () => {
    const range = resolveReportRange({ from: "2026-09-01", to: "2026-09-30" });

    expect(range.from.toISOString()).toBe("2026-09-01T03:00:00.000Z");
    expect(range.to.toISOString()).toBe("2026-10-01T03:00:00.000Z");
  });
});
