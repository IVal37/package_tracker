import { NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/auth/session";
import { createSupabaseServerClient } from "@/lib/auth/supabase-server";
import { getDb } from "@/lib/db/client";
import { refreshUserEmail } from "@/lib/db/users";
import { getEnv } from "@/lib/env";

export const dynamic = "force-dynamic";

/**
 * Signs out a session whose account no longer exists (deleted on another
 * device while this device's token was still valid), then shows the
 * "deleted" page, which also clears this device. Pages cannot change cookies
 * while rendering, so requireLiveAccount sends them here.
 *
 * A live account is never signed out here, only sent home, so a link to this
 * address cannot sign anyone out. Fixed destinations only.
 */
export async function GET(): Promise<Response> {
  const { APP_URL } = getEnv();
  const user = await getCurrentUser();
  if (!user) return NextResponse.redirect(new URL("/sign-in", APP_URL));

  if (await refreshUserEmail(getDb(), user)) {
    return NextResponse.redirect(new URL("/", APP_URL));
  }

  const supabase = await createSupabaseServerClient();
  await supabase.auth.signOut({ scope: "local" }).catch(() => {});
  return NextResponse.redirect(new URL("/account-deleted", APP_URL));
}
