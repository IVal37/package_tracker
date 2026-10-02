import { NextResponse, type NextRequest } from "next/server";
import { completeSignIn } from "@/lib/auth/callback";
import { createSupabaseServerClient } from "@/lib/auth/supabase-server";
import { getDb } from "@/lib/db/client";
import { getEnv } from "@/lib/env";

/** Magic-link and Google sign-ins both land here with a one-time ?code=. */
export async function GET(request: NextRequest) {
  const { APP_URL } = getEnv();

  let ok = false;
  try {
    ok = await completeSignIn({
      supabase: await createSupabaseServerClient(),
      db: getDb(),
      code: request.nextUrl.searchParams.get("code"),
    });
  } catch {
    ok = false;
  }

  // Fixed destinations only: there is no ?next= param, so no open redirect.
  return NextResponse.redirect(
    new URL(ok ? "/" : "/sign-in?error=auth", APP_URL),
  );
}
