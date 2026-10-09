// The hourly and daily housekeeping for alerts. Thin on purpose: the jobs call
// these, and these call the system-scope queries.
import type { Db } from "@/lib/db/client";
import {
  deleteNotificationsBefore,
  findPendingNotificationIds,
  insertOverdueAlerts,
} from "@/lib/db/notify-sync";
import { SWEEP_AFTER_MS } from "./send";

/** Alerts are kept this long for debugging, then deleted. */
export const KEEP_NOTIFICATIONS_DAYS = 90;
const DAY_MS = 24 * 60 * 60 * 1000;

export interface SweepResult {
  /** Overdue alerts recorded just now; they have never been sent for. */
  fresh: string[];
  /** Older alerts still pending: their delivery event never ran, or is waiting out quiet hours. */
  retry: string[];
}

/**
 * Finds delay alerts that are due (an ETA more than a day past) and records
 * them, and finds alerts whose delivery event seems lost. Safe to run often:
 * the overdue key and the event ids de-duplicate.
 */
export async function sweepNotifications(args: {
  db: Db;
  now: Date;
  limit: number;
}): Promise<SweepResult> {
  const { db, now, limit } = args;
  const fresh = await insertOverdueAlerts(db, now, limit);
  const retry = await findPendingNotificationIds(
    db,
    new Date(now.getTime() - SWEEP_AFTER_MS),
    limit,
  );
  return { fresh, retry };
}

/** Deletes alerts older than 90 days. */
export async function cleanupNotifications(args: {
  db: Db;
  now: Date;
}): Promise<{ deleted: number }> {
  const cutoff = new Date(
    args.now.getTime() - KEEP_NOTIFICATIONS_DAYS * DAY_MS,
  );
  return { deleted: await deleteNotificationsBefore(args.db, cutoff) };
}
