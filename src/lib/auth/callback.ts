import type { SupabaseClient } from "@supabase/supabase-js";
import type { Db } from "@/lib/db/client";
import { ensureUser } from "@/lib/db/users";

type AuthClient = Pick<SupabaseClient, "auth">;

/**
 * Finishes a magic-link or OAuth sign-in: swaps the one-time code for a
 * session (set as cookies by the Supabase client) and makes sure the app's
 * user row exists. Returns false for anything that should send the user back
 * to /sign-in.
 */
export async function completeSignIn(params: {
  supabase: AuthClient;
  db: Db;
  code: string | null;
}): Promise<boolean> {
  const { supabase, db, code } = params;
  if (!code) return false;

  const { data, error } = await supabase.auth.exchangeCodeForSession(code);
  const user = data?.user;
  if (error || !user?.email) return false;

  try {
    await ensureUser(db, { id: user.id, email: user.email });
  } catch (failure) {
    // The exchange already set the session cookies. A session without its
    // user row would later look like a deleted account, so undo it first.
    await supabase.auth.signOut({ scope: "local" }).catch(() => {});
    throw failure;
  }
  return true;
}
