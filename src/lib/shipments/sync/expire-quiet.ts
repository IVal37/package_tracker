import type { Db } from "@/lib/db/client";
import { expireQuietBefore } from "@/lib/db/tracker-sync";

const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * Marks shipments Expired after EXPIRE_AFTER_DAYS with no tracker event (or,
 * with no event at all, that long after they were added). Ship24 never sends
 * this status itself. Expired shipments are not re-fetched; a tracker that
 * wakes up later moves the shipment on by the normal event-time rule.
 */
export async function expireQuietShipments(args: {
  db: Db;
  now: Date;
  expireAfterDays: number;
}): Promise<{ expired: number }> {
  const { db, now, expireAfterDays } = args;
  const cutoff = new Date(now.getTime() - expireAfterDays * DAY_MS);
  return { expired: await expireQuietBefore(db, cutoff, now) };
}
