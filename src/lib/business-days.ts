// Next-open-business-day math (task 6.1). Pure function, zero DB access —
// callers (src/modules/orders/order.service.ts) fetch StoreHours/Holiday
// rows via Prisma and pass them in as plain data, which is what keeps this
// file trivially unit-testable with a fake clock.
//
// Backs:
//   - design.md: "RESERVED (pickup cash/transfer reservation) → closing
//     time of the next open business day, computed from StoreHours +
//     Holiday."
//   - specs/pickup-reservation/spec.md "Bounded Hold Window" ("A reservation
//     MUST be held only until the next business day the physical store is
//     open").
//
// Timezone note: `opensAt`/`closesAt` are Postgres `TIME` columns, seeded
// as UTC ISO strings anchored to the 1970-01-01 epoch (see prisma/seed.ts's
// DEFAULT_OPENS_AT/DEFAULT_CLOSES_AT) — i.e. the store's wall-clock hours
// are represented as UTC hour/minute components, not converted through a
// real IANA timezone. This module reads and writes exclusively via the UTC
// Date accessors (getUTCDay, getUTCHours, Date.UTC, ...) so "9am" in the
// seed always means the same wall-clock instant here, regardless of the
// host machine's local timezone. Real timezone-aware conversion (e.g.
// America/Argentina/Buenos_Aires) is out of MVP scope — not raised as an
// open question in design.md, so this file does not attempt it.

/** A single StoreHours row, decoupled from the Prisma-generated shape on
 * purpose — this module has zero DB dependency (task 6.1's "no DB needed"
 * constraint). `weekday` follows JS Date#getDay(): 0 = Sunday ... 6 =
 * Saturday, matching prisma/seed.ts's STORE_HOURS_SEED convention. */
export interface StoreHoursRow {
  weekday: number;
  opensAt: Date;
  closesAt: Date;
  closed: boolean;
}

export interface NextOpenBusinessDayCloseInput {
  /** The instant a reservation is being placed. */
  now: Date;
  storeHours: StoreHoursRow[];
  /** Date-only Holiday rows (time-of-day is ignored — only the calendar
   * date, in UTC, is compared). */
  holidays: Date[];
}

/** Number of calendar days scanned forward before giving up — generous
 * enough to always find a real open day for any sane StoreHours
 * configuration, while still failing fast on a genuine misconfiguration
 * (e.g. every weekday marked `closed`) instead of looping forever. */
const MAX_DAYS_SCANNED = 366;

function toUtcDateKey(date: Date): string {
  return `${date.getUTCFullYear()}-${date.getUTCMonth()}-${date.getUTCDate()}`;
}

function addUtcDays(date: Date, days: number): Date {
  const copy = new Date(date.getTime());
  copy.setUTCDate(copy.getUTCDate() + days);
  return copy;
}

/** Combines `date`'s UTC calendar day with `time`'s UTC time-of-day into a
 * single Date — e.g. (2026-08-10, 19:00) → 2026-08-10T19:00:00.000Z. */
function combineUtcDateAndTime(date: Date, time: Date): Date {
  return new Date(
    Date.UTC(
      date.getUTCFullYear(),
      date.getUTCMonth(),
      date.getUTCDate(),
      time.getUTCHours(),
      time.getUTCMinutes(),
      time.getUTCSeconds(),
      time.getUTCMilliseconds(),
    ),
  );
}

/**
 * Finds the closing-time instant of the next open business day, starting
 * from `now`:
 *   - If TODAY is an open day (StoreHours row for today's weekday,
 *     `closed: false`, and no Holiday matches today) AND `now` is strictly
 *     before today's closing time, the result is TODAY's closing time.
 *   - Otherwise, scans forward one day at a time (skipping closed weekdays
 *     and Holiday dates) until it finds an open day, and returns THAT day's
 *     closing time.
 *
 * Throws if no open day is found within `MAX_DAYS_SCANNED` — a
 * StoreHours misconfiguration (e.g. every weekday closed), not a normal
 * runtime condition.
 */
export function nextOpenBusinessDayClose(input: NextOpenBusinessDayCloseInput): Date {
  const { now, storeHours, holidays } = input;

  const hoursByWeekday = new Map(storeHours.map((row) => [row.weekday, row]));
  const holidayKeys = new Set(holidays.map(toUtcDateKey));

  let candidate = now;
  for (let daysAhead = 0; daysAhead < MAX_DAYS_SCANNED; daysAhead++) {
    const weekday = candidate.getUTCDay();
    const hours = hoursByWeekday.get(weekday);
    const isHoliday = holidayKeys.has(toUtcDateKey(candidate));
    const isOpenDay = hours !== undefined && !hours.closed && !isHoliday;

    if (isOpenDay) {
      const closingTime = combineUtcDateAndTime(candidate, hours.closesAt);
      if (daysAhead > 0 || now.getTime() < closingTime.getTime()) {
        return closingTime;
      }
    }

    candidate = addUtcDays(candidate, 1);
  }

  throw new Error(
    "nextOpenBusinessDayClose: no open business day found within " +
      `${MAX_DAYS_SCANNED} days — check StoreHours configuration.`,
  );
}
