// "Delete my account": everything Wayfind holds about the user, and their
// sign-in account at Supabase.
import { getAuthAdmin, type AuthAdmin } from "@/lib/auth/admin";
import type { Db } from "@/lib/db/client";
import { listTrackerIds } from "@/lib/db/shipments";
import { deleteUserRow } from "@/lib/db/users";
import { reportIssue } from "@/lib/monitoring";
import { LIMITS, hit, logLimited } from "@/lib/ratelimit";
import { releaseTracker } from "@/lib/shipments/sync/release-tracker";
import type { TrackingProvider } from "@/lib/tracking";

export type DeleteAccountResult =
  /** All gone. `signInRemoved` is false if only the sign-in account is left. */
  | { status: "deleted"; signInRemoved: boolean }
  | { status: "rate_limited" }
  /** Deletion is not set up on this server (no secret key); nothing was touched. */
  | { status: "unavailable" };

/**
 * Deletes the user, in this order:
 *
 * 1. Stop the provider tracking numbers that no other user follows.
 * 2. Delete the user row; every table of theirs cascades from it.
 * 3. Delete the sign-in account at Supabase.
 *
 * The data goes first on purpose: if step 3 fails, what is left is a login
 * with no data behind it (harmless, and reported so a human can remove it),
 * never data that nobody can reach. Provider failures in step 1 are logged and
 * never block the deletion.
 */
export async function deleteAccount(args: {
  db: Db;
  provider: TrackingProvider;
  /** Defaults to the configured one; null when SUPABASE_SECRET_KEY is unset. */
  authAdmin?: AuthAdmin | null;
  userId: string;
  now: Date;
}): Promise<DeleteAccountResult> {
  const { db, provider, userId, now } = args;
  const authAdmin =
    args.authAdmin === undefined ? getAuthAdmin() : args.authAdmin;

  // Refuse before touching anything if the sign-in cannot be removed.
  if (!authAdmin) return { status: "unavailable" };
  if (!(await hit(db, LIMITS.deleteAccount, userId, now)).allowed) {
    logLimited(LIMITS.deleteAccount.action);
    return { status: "rate_limited" };
  }

  for (const trackerId of await listTrackerIds(db, userId, provider.name)) {
    await releaseTracker({ db, provider, trackerId, userId });
  }

  await deleteUserRow(db, userId);

  try {
    await authAdmin.deleteUser(userId);
    return { status: "deleted", signInRemoved: true };
  } catch (error) {
    reportIssue("account_deletion_incomplete", {
      user_id: userId,
      error: error instanceof Error ? error.name.toLowerCase() : "unknown",
    });
    return { status: "deleted", signInRemoved: false };
  }
}
