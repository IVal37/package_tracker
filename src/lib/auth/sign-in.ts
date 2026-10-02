import type { SupabaseClient } from "@supabase/supabase-js";
import { z } from "zod";

type AuthClient = Pick<SupabaseClient, "auth">;

const emailSchema = z.email();

export type MagicLinkResult =
  { ok: true } | { ok: false; error: "invalid_email" | "send_failed" };

export type OAuthResult = { ok: true; url: string } | { ok: false };

const callbackUrl = (appUrl: string) => `${appUrl}/auth/callback`;

/** Emails a magic link. The link returns to /auth/callback. */
export async function requestMagicLink(
  supabase: AuthClient,
  rawEmail: string,
  appUrl: string,
): Promise<MagicLinkResult> {
  const parsed = emailSchema.safeParse(rawEmail.trim().toLowerCase());
  if (!parsed.success) return { ok: false, error: "invalid_email" };

  const { error } = await supabase.auth.signInWithOtp({
    email: parsed.data,
    options: { emailRedirectTo: callbackUrl(appUrl) },
  });
  return error ? { ok: false, error: "send_failed" } : { ok: true };
}

/** Starts the Google flow and returns the URL to send the browser to. */
export async function startGoogleSignIn(
  supabase: AuthClient,
  appUrl: string,
): Promise<OAuthResult> {
  const { data, error } = await supabase.auth.signInWithOAuth({
    provider: "google",
    options: { redirectTo: callbackUrl(appUrl) },
  });
  return error || !data.url ? { ok: false } : { ok: true, url: data.url };
}
