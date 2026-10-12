import { redirect } from "next/navigation";
import type { Db } from "@/lib/db/client";
import { refreshUserEmail } from "@/lib/db/users";
import type { CurrentUser } from "./session";

/** Where a session whose account is gone is sent to be signed out. */
export const ENDED_SESSION_PATH = "/auth/ended";

/**
 * Makes sure the signed-in user's account still exists before anything is
 * written for them, and refreshes its email.
 *
 * The user row is created only when a sign-in completes. After "Delete my
 * account", another device's access token stays valid for up to an hour (it
 * is checked by signature only); recreating the row there would bring the
 * deleted email back. Such a session is sent to ENDED_SESSION_PATH, which
 * signs it out, instead.
 */
export async function requireLiveAccount(
  db: Db,
  user: CurrentUser,
): Promise<void> {
  if (await refreshUserEmail(db, user)) return;
  redirect(ENDED_SESSION_PATH);
}
