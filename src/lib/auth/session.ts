import { redirect } from "next/navigation";
import { createSupabaseServerClient } from "./supabase-server";

export interface CurrentUser {
  id: string;
  email: string;
}

/**
 * The signed-in user, or null. Uses getClaims(), which verifies the JWT
 * signature; never trust getSession() on the server.
 */
export async function getCurrentUser(): Promise<CurrentUser | null> {
  const supabase = await createSupabaseServerClient();
  const { data, error } = await supabase.auth.getClaims();
  if (error || !data) return null;

  const { sub, email } = data.claims;
  if (!sub || !email) return null;
  return { id: sub, email };
}

/** For protected pages and actions: the user, or a redirect to sign-in. */
export async function requireUser(): Promise<CurrentUser> {
  const user = await getCurrentUser();
  if (!user) redirect("/sign-in");
  return user;
}
