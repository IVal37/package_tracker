import type { CookieOptionsWithName } from "@supabase/ssr";

/**
 * Options for the Supabase session cookies. Only the server ever reads them
 * (there is no browser Supabase client), so they are httpOnly: a script on
 * the page, even an injected one, cannot read the session. Secure whenever
 * the app is served over https, so local http development still signs in.
 */
export function sessionCookieOptions(appUrl: string): CookieOptionsWithName {
  return {
    httpOnly: true,
    secure: new URL(appUrl).protocol === "https:",
    sameSite: "lax",
    path: "/",
  };
}
