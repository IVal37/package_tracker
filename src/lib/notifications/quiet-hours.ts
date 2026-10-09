// Quiet hours: a daily window, in the user's time zone, during which alerts
// wait instead of buzzing. The window may wrap midnight (22:00 to 07:00).
// Pure, with the time zone handled by Intl so daylight saving is the platform's
// job.

export interface QuietHours {
  enabled: boolean;
  /** Minutes after midnight, 0 to 1439. */
  start: number;
  end: number;
  /** IANA name such as "America/Chicago". */
  timeZone: string;
}

const MINUTE_MS = 60_000;
const DAY_MINUTES = 24 * 60;

/** True if the runtime knows this IANA time zone. */
export function isValidTimeZone(timeZone: string): boolean {
  try {
    new Intl.DateTimeFormat("en-US", { timeZone });
    return true;
  } catch {
    return false;
  }
}

/** Minutes after midnight on the clock in that zone; UTC if the zone is unknown. */
export function localMinutes(date: Date, timeZone: string): number {
  const zone = isValidTimeZone(timeZone) ? timeZone : "UTC";
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: zone,
    hour: "numeric",
    minute: "numeric",
    hourCycle: "h23",
  }).formatToParts(date);
  const get = (type: string) =>
    Number(parts.find((part) => part.type === type)?.value ?? 0);
  return get("hour") * 60 + get("minute");
}

/** Is the clock in the user's zone inside their quiet window right now? */
export function isQuietNow(now: Date, quiet: QuietHours): boolean {
  // Equal start and end is an empty window, not a 24-hour one.
  if (!quiet.enabled || quiet.start === quiet.end) return false;
  const minutes = localMinutes(now, quiet.timeZone);
  return quiet.start < quiet.end
    ? minutes >= quiet.start && minutes < quiet.end
    : minutes >= quiet.start || minutes < quiet.end;
}

/** Shortest signed distance in minutes from clock time `b` to clock time `a`. */
function clockDifference(a: number, b: number): number {
  return (
    ((a - b + DAY_MINUTES / 2 + DAY_MINUTES) % DAY_MINUTES) - DAY_MINUTES / 2
  );
}

/**
 * When quiet hours next end, as an instant, or null when it is not quiet now.
 * The moment lands on a whole minute of the end time on the user's clock. Adding
 * the plain wait is right except across a daylight-saving change, where the
 * clock jumps; so the guess is nudged until the clock reads the end time.
 */
export function quietHoursEnd(now: Date, quiet: QuietHours): Date | null {
  if (!isQuietNow(now, quiet)) return null;

  const wholeMinute = Math.floor(now.getTime() / MINUTE_MS) * MINUTE_MS;
  const current = localMinutes(now, quiet.timeZone);
  const wait = (quiet.end - current + DAY_MINUTES) % DAY_MINUTES;
  let end = new Date(wholeMinute + wait * MINUTE_MS);

  for (let tries = 0; tries < 3; tries++) {
    const off = clockDifference(quiet.end, localMinutes(end, quiet.timeZone));
    if (off === 0) break;
    end = new Date(end.getTime() + off * MINUTE_MS);
  }
  return end;
}
