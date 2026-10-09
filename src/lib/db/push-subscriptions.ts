// Browsers and devices that agreed to receive push. Every function takes the
// userId and filters by it, so another user's device looks exactly like a
// missing one.
import { and, eq } from "drizzle-orm";
import type { Db } from "./client";
import { pushSubscriptions } from "./schema";
import { isUuid } from "./shipments";

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
  await db
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
