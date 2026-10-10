// The admin page's data and who may see it. The only importer of the
// system-scope admin-stats module (ESLint enforces it).
import type { Db } from "@/lib/db/client";
import {
  adminCounts,
  trackersCreatedPerDay,
  type AdminCounts,
  type DayCount,
} from "@/lib/db/admin-stats";

const DAY_MS = 24 * 60 * 60 * 1000;

/** ADMIN_EMAILS is already lower-cased; an empty list means nobody. */
export function isAdmin(
  email: string,
  adminEmails: readonly string[],
): boolean {
  return adminEmails.includes(email.trim().toLowerCase());
}

export interface AdminStats extends AdminCounts {
  provider: string;
  /** The last 30 UTC days, oldest first, including days with none. */
  trackersPerDay: DayCount[];
  /** Trackers first used this UTC calendar month. */
  monthSoFar: number;
  /** SHIP24_MONTHLY_ALLOWANCE, or null when not set. */
  allowance: number | null;
}

const utcDay = (date: Date) => date.toISOString().slice(0, 10);

/** Everything the admin page shows. Counts and times only. */
export async function loadAdminStats(args: {
  db: Db;
  provider: string;
  allowance: number | null;
  now: Date;
}): Promise<AdminStats> {
  const { db, provider, allowance, now } = args;
  const today = Date.UTC(
    now.getUTCFullYear(),
    now.getUTCMonth(),
    now.getUTCDate(),
  );
  const windowStart = new Date(today - 29 * DAY_MS);
  const monthStart = new Date(
    Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1),
  );
  const since = windowStart < monthStart ? windowStart : monthStart;

  const [byDay, counts] = await Promise.all([
    trackersCreatedPerDay(db, provider, since),
    adminCounts(db, new Date(now.getTime() - 7 * DAY_MS)),
  ]);

  const found = new Map(byDay.map((row) => [row.day, row.count]));
  const trackersPerDay = Array.from({ length: 30 }, (_, i) => {
    const day = utcDay(new Date(windowStart.getTime() + i * DAY_MS));
    return { day, count: found.get(day) ?? 0 };
  });
  const monthKey = utcDay(monthStart).slice(0, 7);
  const monthSoFar = byDay
    .filter((row) => row.day.startsWith(monthKey))
    .reduce((sum, row) => sum + row.count, 0);

  return { ...counts, provider, trackersPerDay, monthSoFar, allowance };
}
