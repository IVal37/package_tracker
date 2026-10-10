// Rate-limit counters. Not user data: a row holds an opaque key (an action and
// a user id or a hash), a window and a count. Shared by every server instance.
import { lt, sql } from "drizzle-orm";
import type { Db } from "./client";
import { rateLimits } from "./schema";

/**
 * Counts one hit in the window and returns the window's new total. One atomic
 * statement, so concurrent hits from any number of instances each count once.
 */
export async function countHit(
  db: Db,
  key: string,
  windowStart: Date,
): Promise<number> {
  const [row] = await db
    .insert(rateLimits)
    .values({ key, windowStart, count: 1 })
    .onConflictDoUpdate({
      target: [rateLimits.key, rateLimits.windowStart],
      set: { count: sql`${rateLimits.count} + 1` },
    })
    .returning({ count: rateLimits.count });
  if (!row) throw new Error("Rate limit upsert returned no row");
  return row.count;
}

/** Deletes windows that started before the cutoff. Returns how many. */
export async function deleteRateLimitWindowsBefore(
  db: Db,
  cutoff: Date,
): Promise<number> {
  const deleted = await db
    .delete(rateLimits)
    .where(lt(rateLimits.windowStart, cutoff))
    .returning({ key: rateLimits.key });
  return deleted.length;
}
