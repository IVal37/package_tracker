// Time arithmetic shared across the app. Pure, and safe in the browser.

export const MINUTE_MS = 60_000;
export const HOUR_MS = 60 * MINUTE_MS;
export const DAY_MS = 24 * HOUR_MS;

/** The moment `ms` before `date`. */
export function msBefore(date: Date, ms: number): Date {
  return new Date(date.getTime() - ms);
}

/** The hour a moment falls in, as a number: event ids use it to repeat once an hour. */
export function hourBucket(date: Date): number {
  return Math.floor(date.getTime() / HOUR_MS);
}

/** The UTC calendar day of a moment, as YYYY-MM-DD. */
export function utcDay(date: Date): string {
  return date.toISOString().slice(0, 10);
}
