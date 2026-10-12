import { eq } from "drizzle-orm";
import type { Db } from "./client";
import { users } from "./schema";

/**
 * Creates the app user row for a Supabase auth user, or refreshes its email.
 * The id is the Supabase auth user id, so there is exactly one row per account.
 *
 * Only a completed sign-in calls this. Everywhere else uses refreshUserEmail
 * (through requireLiveAccount), which never creates a row.
 */
export async function ensureUser(
  db: Db,
  user: { id: string; email: string },
): Promise<void> {
  await db
    .insert(users)
    .values({ id: user.id, email: user.email })
    .onConflictDoUpdate({ target: users.id, set: { email: user.email } });
}

/**
 * Refreshes the email on the user's row and says whether the row exists. It
 * never creates one: outside sign-in, a session with no row belongs to an
 * account that was deleted, and recreating the row would bring its email back.
 */
export async function refreshUserEmail(
  db: Db,
  user: { id: string; email: string },
): Promise<boolean> {
  const updated = await db
    .update(users)
    .set({ email: user.email })
    .where(eq(users.id, user.id))
    .returning({ id: users.id });
  return updated.length > 0;
}

/**
 * Deletes the user's row. Every table holding their data cascades from it
 * (shipments, checkpoints, orders, emails, alerts, settings, devices).
 * Returns whether there was one.
 */
export async function deleteUserRow(db: Db, userId: string): Promise<boolean> {
  const deleted = await db
    .delete(users)
    .where(eq(users.id, userId))
    .returning({ id: users.id });
  return deleted.length > 0;
}

/** The email address the account was created with, or null if there is no such user. */
export async function getUserEmail(
  db: Db,
  userId: string,
): Promise<string | null> {
  const [row] = await db
    .select({ email: users.email })
    .from(users)
    .where(eq(users.id, userId));
  return row?.email ?? null;
}
