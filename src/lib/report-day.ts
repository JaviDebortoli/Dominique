// Financial day-close boundaries for the revenue report (control-de-caja
// design.md D5). Fixed UTC−3 offset: Argentina has had no DST since 2009
// and the app is single-locale es-AR, so this is exact and needs no IANA
// timezone dependency.
//
// Deliberately NOT shared with src/lib/business-days.ts, which treats the
// wall clock as UTC on purpose (a documented MVP shortcut — hold expiry
// only needs coarse day granularity). A financial day-close cannot tolerate
// that drift: a 21:30 ART sale is 00:30 UTC the NEXT calendar day, and
// would land on the wrong day's report if bucketed by naive UTC date. This
// module's whole reason to exist is getting that one case right.
//
// Also deliberately NOT shared with sale.service.ts's private
// startOfArgentinaDay(now: Date) helper (same-caja-day void window) — same
// UTC−3 idea, but that one answers "what is the start of TODAY, right now"
// from an instant, while this one answers "resolve this REQUESTED
// YYYY-MM-DD string" from user input. Different questions, same constant.

const ARGENTINA_UTC_OFFSET_HOURS = 3;
const ONE_DAY_MS = 24 * 60 * 60 * 1000;

/**
 * Resolves a `YYYY-MM-DD` string (e.g. from a `<input type="date">`) to the
 * UTC instant that is midnight in Argentina (UTC−3) on that calendar day —
 * `Date.UTC(y, m, d, 3, 0, 0)` (design.md D5, verbatim).
 */
export function resolveArgentinaDayStart(dateStr: string): Date {
  const [year, month, day] = dateStr.split("-").map(Number);
  return new Date(Date.UTC(year, month - 1, day, ARGENTINA_UTC_OFFSET_HOURS, 0, 0, 0));
}

export interface ReportDayRange {
  /** Inclusive start instant. */
  from: Date;
  /** Exclusive end instant — half-open range, per design.md diagram (d). */
  to: Date;
}

/**
 * design.md diagram (d): "[fromUtc, toUtcExclusive)". A single day is
 * `from === to` in the input — one code path, no day-vs-range branch: the
 * exclusive upper bound is always "the day AFTER `to`'s 03:00Z instant",
 * which for a single day is exactly the next calendar day's boundary.
 */
export function resolveReportRange(range: { from: string; to: string }): ReportDayRange {
  const from = resolveArgentinaDayStart(range.from);
  const toInclusiveDayStart = resolveArgentinaDayStart(range.to);
  const to = new Date(toInclusiveDayStart.getTime() + ONE_DAY_MS);
  return { from, to };
}
