import type { Db } from "@/lib/db/client";
import { archiveDeliveredBefore } from "@/lib/db/tracker-sync";

/** Delivered shipments leave the list this many days after their last event. */
export const ARCHIVE_AFTER_DAYS = 14;

const DAY_MS = 24 * 60 * 60 * 1000;

/** Archives shipments delivered 14 or more days ago. Returns how many. */
export async function archiveDeliveredShipments(args: {
  db: Db;
  now: Date;
}): Promise<{ archived: number }> {
  const { db, now } = args;
  const cutoff = new Date(now.getTime() - ARCHIVE_AFTER_DAYS * DAY_MS);
  return { archived: await archiveDeliveredBefore(db, cutoff, now) };
}
