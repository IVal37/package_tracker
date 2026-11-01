import type { Db } from "@/lib/db/client";
import {
  archiveDeliveredBefore,
  archiveExpiredBefore,
} from "@/lib/db/tracker-sync";
import { DAY_MS, msBefore } from "@/lib/time";

/** Delivered and Expired shipments leave the list this many days later. */
export const ARCHIVE_AFTER_DAYS = 14;

/**
 * Archives shipments delivered 14 or more days ago, and Expired ones 14 or
 * more days after they expired (they expire after `expireAfterDays` quiet
 * days, so that is `expireAfterDays + 14` quiet days). Returns how many.
 */
export async function archiveDeliveredShipments(args: {
  db: Db;
  now: Date;
  expireAfterDays: number;
}): Promise<{ archived: number; archivedExpired: number }> {
  const { db, now, expireAfterDays } = args;
  const cutoff = msBefore(now, ARCHIVE_AFTER_DAYS * DAY_MS);
  const expiredCutoff = msBefore(
    now,
    (expireAfterDays + ARCHIVE_AFTER_DAYS) * DAY_MS,
  );
  return {
    archived: await archiveDeliveredBefore(db, cutoff, now),
    archivedExpired: await archiveExpiredBefore(db, expiredCutoff, now),
  };
}
