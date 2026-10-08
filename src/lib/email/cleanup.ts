import type { Db } from "@/lib/db/client";
import {
  deleteEmailsBefore,
  deleteStaleOrdersBefore,
  findStalePendingEmailIds,
} from "@/lib/db/inbound-sync";

/** Raw inbound emails are deleted after this long (CLAUDE.md privacy rule). */
export const RAW_EMAIL_DAYS = 30;
/** An "Ordered" placeholder that never shipped is dropped after this long. */
export const STALE_ORDER_DAYS = 90;
/** A pending email older than this has lost its event; the sweep re-queues it. */
export const PENDING_GRACE_MINUTES = 5;

const DAY_MS = 24 * 60 * 60 * 1000;
const MINUTE_MS = 60 * 1000;

/** Deletes old raw emails and placeholders nobody shipped. Returns how many of each. */
export async function cleanupInboundData(args: {
  db: Db;
  now: Date;
}): Promise<{ emails: number; orders: number }> {
  const { db, now } = args;
  return {
    emails: await deleteEmailsBefore(
      db,
      new Date(now.getTime() - RAW_EMAIL_DAYS * DAY_MS),
    ),
    orders: await deleteStaleOrdersBefore(
      db,
      new Date(now.getTime() - STALE_ORDER_DAYS * DAY_MS),
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
    new Date(now.getTime() - PENDING_GRACE_MINUTES * MINUTE_MS),
    limit,
  );
}
