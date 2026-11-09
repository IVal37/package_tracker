import type { Db } from "@/lib/db/client";
import {
  deleteEmailsBefore,
  deleteStaleOrdersBefore,
  findStalePendingEmailIds,
} from "@/lib/db/inbound-sync";
import { DAY_MS, MINUTE_MS, msBefore } from "@/lib/time";

/** Raw inbound emails are deleted after this long (CLAUDE.md privacy rule). */
export const RAW_EMAIL_DAYS = 30;
/** An order that never got a package is dropped after this long without an email. */
export const STALE_ORDER_DAYS = 90;
/** An order known only from a "delivered" email has nothing left to show after this long. */
export const DELIVERED_ORDER_DAYS = 14;
/** A pending email older than this has lost its event; the sweep re-queues it. */
export const PENDING_GRACE_MINUTES = 5;

/** Deletes old raw emails and placeholders nobody shipped. Returns how many of each. */
export async function cleanupInboundData(args: {
  db: Db;
  now: Date;
}): Promise<{ emails: number; orders: number }> {
  const { db, now } = args;
  return {
    emails: await deleteEmailsBefore(
      db,
      msBefore(now, RAW_EMAIL_DAYS * DAY_MS),
    ),
    orders: await deleteStaleOrdersBefore(
      db,
      msBefore(now, STALE_ORDER_DAYS * DAY_MS),
      msBefore(now, DELIVERED_ORDER_DAYS * DAY_MS),
    ),
  };
}

/** Emails stuck in "pending" long enough that their processing event is lost. */
export function findStuckEmailIds(args: {
  db: Db;
  now: Date;
  limit: number;
}): Promise<string[]> {
  const { db, now, limit } = args;
  return findStalePendingEmailIds(
    db,
    msBefore(now, PENDING_GRACE_MINUTES * MINUTE_MS),
    limit,
  );
}
