"use server";

import { redirect } from "next/navigation";
import { requestMagicLink, startGoogleSignIn } from "@/lib/auth/sign-in";
import { createSupabaseServerClient } from "@/lib/auth/supabase-server";
import { getEnv } from "@/lib/env";

export type SignInState =
  | { status: "idle" }
  | { status: "sent" }
  | { status: "error"; message: string };

const MESSAGES = {
  invalid_email: "Enter a valid email address.",
  send_failed: "We couldn't send the sign-in link. Please try again.",
} as const;

export async function signInWithEmail(
  _previous: SignInState,
  formData: FormData,
): Promise<SignInState> {
  const result = await requestMagicLink(
    await createSupabaseServerClient(),
    String(formData.get("email") ?? ""),
    getEnv().APP_URL,
  );
  return result.ok
    ? { status: "sent" }
    : { status: "error", message: MESSAGES[result.error] };
}

export async function signInWithGoogle(): Promise<void> {
  const result = await startGoogleSignIn(
    await createSupabaseServerClient(),
    getEnv().APP_URL,
  );
  redirect(result.ok ? result.url : "/sign-in?error=google");
}

export async function signOut(): Promise<void> {
  const supabase = await createSupabaseServerClient();
  await supabase.auth.signOut();
  redirect("/sign-in");
}
