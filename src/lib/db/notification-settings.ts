// A user's notification preferences. Every function takes the userId and
// touches only that user's row.
import { eq } from "drizzle-orm";
import {
  columnsFromPrefs,
  prefsFromRow,
  type NotificationPrefs,
} from "@/lib/notifications/prefs";
import type { Db } from "./client";
import { notificationSettings } from "./schema";

/** The user's preferences, or the defaults when they have never saved any. */
export async function getNotificationPrefs(
  db: Db,
  userId: string,
): Promise<NotificationPrefs> {
  const [row] = await db
    .select()
    .from(notificationSettings)
    .where(eq(notificationSettings.userId, userId));
  return prefsFromRow(row);
}

/**
 * Saves the preferences, creating the row on first save. The caller has already
 * validated them (see prefsSchema); the database also bounds the quiet minutes.
 */
export async function saveNotificationPrefs(
  db: Db,
  userId: string,
  prefs: NotificationPrefs,
  now = new Date(),
): Promise<void> {
  const columns = columnsFromPrefs(prefs);
  await db
    .insert(notificationSettings)
    .values({ userId, ...columns, updatedAt: now })
    .onConflictDoUpdate({
      target: notificationSettings.userId,
      set: { ...columns, updatedAt: now },
    });
}
