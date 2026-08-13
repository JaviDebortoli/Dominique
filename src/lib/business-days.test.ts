import { describe, expect, it } from "vitest";
import { nextOpenBusinessDayClose, type StoreHoursRow } from "./business-days";

// Pure-function unit tests (fake clock, no DB) — task 6.1.
// Backs design.md's "RESERVED (pickup cash/transfer reservation) → closing
// time of the next open business day, computed from StoreHours + Holiday"
// and specs/pickup-reservation/spec.md "Bounded Hold Window".
//
// All dates below are expressed in UTC (Date.UTC / "...Z" ISO strings) and
// business-days.ts reads/writes exclusively via the UTC Date accessors, so
// the wall-clock semantics stay internally consistent regardless of the
// host machine's timezone — see business-days.ts's module doc for why.
describe("business-days — nextOpenBusinessDayClose (task 6.1, fake clock)", () => {
  // Mon-Fri open 09:00-19:00, Sat/Sun closed (prisma/seed.ts's default).
  const STORE_HOURS: StoreHoursRow[] = [
    { weekday: 0, opensAt: time(9, 0), closesAt: time(19, 0), closed: true }, // Sun
    { weekday: 1, opensAt: time(9, 0), closesAt: time(19, 0), closed: false }, // Mon
    { weekday: 2, opensAt: time(9, 0), closesAt: time(19, 0), closed: false }, // Tue
    { weekday: 3, opensAt: time(9, 0), closesAt: time(19, 0), closed: false }, // Wed
    { weekday: 4, opensAt: time(9, 0), closesAt: time(19, 0), closed: false }, // Thu
    { weekday: 5, opensAt: time(9, 0), closesAt: time(19, 0), closed: false }, // Fri
    { weekday: 6, opensAt: time(9, 0), closesAt: time(19, 0), closed: true }, // Sat
  ];

  function time(hours: number, minutes: number): Date {
    return new Date(Date.UTC(1970, 0, 1, hours, minutes, 0, 0));
  }

  it("Mon-Fri open, during business hours: next open business day is TODAY, at today's closing time", () => {
    // Monday 2026-08-10 12:00 UTC (within 09:00-19:00).
    const now = new Date(Date.UTC(2026, 7, 10, 12, 0, 0));

    const result = nextOpenBusinessDayClose({ now, storeHours: STORE_HOURS, holidays: [] });

    expect(result.toISOString()).toBe(new Date(Date.UTC(2026, 7, 10, 19, 0, 0)).toISOString());
  });

  it("after-hours rolls forward: reserving after closing time on an open weekday moves to the NEXT day's closing time", () => {
    // Monday 2026-08-10 20:00 UTC — after the 19:00 close.
    const now = new Date(Date.UTC(2026, 7, 10, 20, 0, 0));

    const result = nextOpenBusinessDayClose({ now, storeHours: STORE_HOURS, holidays: [] });

    // Tuesday 2026-08-11 19:00 UTC.
    expect(result.toISOString()).toBe(new Date(Date.UTC(2026, 7, 11, 19, 0, 0)).toISOString());
  });

  it("Sat/Sun closed: reserving on Saturday rolls all the way forward to Monday's closing time", () => {
    // Saturday 2026-08-08 10:00 UTC.
    const now = new Date(Date.UTC(2026, 7, 8, 10, 0, 0));

    const result = nextOpenBusinessDayClose({ now, storeHours: STORE_HOURS, holidays: [] });

    // Monday 2026-08-10 19:00 UTC.
    expect(result.toISOString()).toBe(new Date(Date.UTC(2026, 7, 10, 19, 0, 0)).toISOString());
  });

  it("triangulation: reserving on Sunday also rolls forward to Monday's closing time", () => {
    // Sunday 2026-08-09 10:00 UTC.
    const now = new Date(Date.UTC(2026, 7, 9, 10, 0, 0));

    const result = nextOpenBusinessDayClose({ now, storeHours: STORE_HOURS, holidays: [] });

    expect(result.toISOString()).toBe(new Date(Date.UTC(2026, 7, 10, 19, 0, 0)).toISOString());
  });

  it("Holiday skipped: a Holiday row on what would otherwise be the next open day pushes it one day further", () => {
    // Friday 2026-08-14 20:00 UTC (after hours) — next open day would be
    // Monday 2026-08-17, but it's a Holiday, so it must roll to Tuesday
    // 2026-08-18.
    const now = new Date(Date.UTC(2026, 7, 14, 20, 0, 0));
    const holidays = [new Date(Date.UTC(2026, 7, 17))];

    const result = nextOpenBusinessDayClose({ now, storeHours: STORE_HOURS, holidays });

    expect(result.toISOString()).toBe(new Date(Date.UTC(2026, 7, 18, 19, 0, 0)).toISOString());
  });

  it("triangulation: a Holiday on today (an otherwise-open weekday) is skipped even during business hours", () => {
    // Monday 2026-08-10 12:00 UTC, but today is a Holiday.
    const now = new Date(Date.UTC(2026, 7, 10, 12, 0, 0));
    const holidays = [new Date(Date.UTC(2026, 7, 10))];

    const result = nextOpenBusinessDayClose({ now, storeHours: STORE_HOURS, holidays });

    // Tuesday 2026-08-11 19:00 UTC.
    expect(result.toISOString()).toBe(new Date(Date.UTC(2026, 7, 11, 19, 0, 0)).toISOString());
  });

  it("boundary: exactly at closing time counts as after-hours (rolls to the next open day)", () => {
    // Monday 2026-08-10 19:00 UTC exactly.
    const now = new Date(Date.UTC(2026, 7, 10, 19, 0, 0));

    const result = nextOpenBusinessDayClose({ now, storeHours: STORE_HOURS, holidays: [] });

    expect(result.toISOString()).toBe(new Date(Date.UTC(2026, 7, 11, 19, 0, 0)).toISOString());
  });

  it("throws when no open day is configured at all (misconfiguration guard)", () => {
    const allClosed: StoreHoursRow[] = STORE_HOURS.map((row) => ({ ...row, closed: true }));
    const now = new Date(Date.UTC(2026, 7, 10, 12, 0, 0));

    expect(() =>
      nextOpenBusinessDayClose({ now, storeHours: allClosed, holidays: [] }),
    ).toThrow();
  });
});
