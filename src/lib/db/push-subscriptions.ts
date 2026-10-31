// Browsers and devices that agreed to receive push. Every function takes the
// userId and filters by it, so another user's device looks exactly like a
// missing one.
import { and, desc, eq, ne, notInArray, sql } from "drizzle-orm";
import type { Db } from "./client";
import { pushSubscriptions } from "./schema";
import { isUuid } from "./shipments";

/**
 * Devices kept per user. The server POSTs to every one on each alert, so a
 * scripted account must not be able to pile them up; a real person rarely has
 * more than three or four.
 */
export const MAX_PUSH_DEVICES = 10;

export type PushSubscriptionRow = typeof pushSubscriptions.$inferSelect;

export interface NewPushSubscription {
  endpoint: string;
  p256dh: string;
  auth: string;
}

export async function listPushSubscriptions(
  db: Db,
  userId: string,
): Promise<PushSubscriptionRow[]> {
  return db
    .select()
    .from(pushSubscriptions)
    .where(eq(pushSubscriptions.userId, userId));
}

/**
 * Stores a device for the user. An endpoint belongs to one browser, so if it
 * was registered under another account (someone signed out and a different
 * person signed in on the same browser) it moves to this user: the previous
 * owner stops getting alerts on a device they no longer hold.
 */
export async function savePushSubscription(
  db: Db,
  userId: string,
  subscription: NewPushSubscription,
): Promise<void> {
  await db.transaction(async (tx) => {
    await tx
      .insert(pushSubscriptions)
      .values({ userId, ...subscription })
      .onConflictDoUpdate({
        target: pushSubscriptions.endpoint,
        set: {
          userId,
          p256dh: subscription.p256dh,
          auth: subscription.auth,
        },
      });

    // Over the cap, the devices not reached for longest go. The one just
    // saved always stays: it is the browser the user is holding.
    const others = and(
      eq(pushSubscriptions.userId, userId),
      ne(pushSubscriptions.endpoint, subscription.endpoint),
    );
    const keep = tx
      .select({ id: pushSubscriptions.id })
      .from(pushSubscriptions)
      .where(others)
      .orderBy(
        desc(
          sql`coalesce(${pushSubscriptions.lastSuccessAt}, ${pushSubscriptions.createdAt})`,
        ),
        desc(pushSubscriptions.createdAt),
      )
      .limit(MAX_PUSH_DEVICES - 1);
    await tx
      .delete(pushSubscriptions)
      .where(and(others, notInArray(pushSubscriptions.id, keep)));
  });
}

/** Removes the user's own device by endpoint. True if there was one. */
export async function removePushSubscription(
  db: Db,
  userId: string,
  endpoint: string,
): Promise<boolean> {
  const removed = await db
    .delete(pushSubscriptions)
    .where(
      and(
        eq(pushSubscriptions.userId, userId),
        eq(pushSubscriptions.endpoint, endpoint),
      ),
    )
    .returning({ id: pushSubscriptions.id });
  return removed.length > 0;
}

/** Removes one of the user's devices the push service reported as gone. */
export async function removePushSubscriptionById(
  db: Db,
  userId: string,
  id: string,
): Promise<boolean> {
  if (!isUuid(id)) return false;
  const removed = await db
    .delete(pushSubscriptions)
    .where(
      and(eq(pushSubscriptions.userId, userId), eq(pushSubscriptions.id, id)),
    )
    .returning({ id: pushSubscriptions.id });
  return removed.length > 0;
}

/** Notes that a push to this device was accepted. */
export async function markPushSuccess(
  db: Db,
  userId: string,
  id: string,
  now: Date,
): Promise<void> {
  if (!isUuid(id)) return;
  await db
    .update(pushSubscriptions)
    .set({ lastSuccessAt: now })
    .where(
      and(eq(pushSubscriptions.userId, userId), eq(pushSubscriptions.id, id)),
    );
}
