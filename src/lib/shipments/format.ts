const DAY_MS = 86_400_000;

/** Midnight at the start of the date's calendar day in the given time zone, as a UTC day number. */
function dayNumber(date: Date, timeZone: string): number {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(date);
  const get = (type: string) =>
    Number(parts.find((p) => p.type === type)?.value);
  return Date.UTC(get("year"), get("month") - 1, get("day")) / DAY_MS;
}

/**
 * Human ETA: "Today", "Tomorrow", a weekday within the next week, otherwise
 * a short date. "Overdue" if the ETA's calendar day has passed.
 */
export function formatEta(
  eta: Date | null,
  now: Date,
  timeZone = "UTC",
): string {
  if (!eta) return "No ETA";

  const days = dayNumber(eta, timeZone) - dayNumber(now, timeZone);
  if (days < 0) return "Overdue";
  if (days === 0) return "Today";
  if (days === 1) return "Tomorrow";
  if (days < 7) {
    return new Intl.DateTimeFormat("en-US", {
      timeZone,
      weekday: "long",
    }).format(eta);
  }
  return new Intl.DateTimeFormat("en-US", {
    timeZone,
    month: "short",
    day: "numeric",
  }).format(eta);
}

const UNITS: [Intl.RelativeTimeFormatUnit, number][] = [
  ["day", DAY_MS],
  ["hour", 3_600_000],
  ["minute", 60_000],
];

/** "5 minutes ago", "yesterday", "2 days ago". */
export function formatRelativeTime(date: Date, now: Date): string {
  const formatter = new Intl.RelativeTimeFormat("en-US", { numeric: "auto" });
  const diff = date.getTime() - now.getTime();
  for (const [unit, ms] of UNITS) {
    if (Math.abs(diff) >= ms)
      return formatter.format(Math.trunc(diff / ms), unit);
  }
  return "just now";
}
