/**
 * Paths reachable without a session. Everything else requires sign-in.
 * The webhook and Inngest routes have no user: each authenticates the caller
 * itself (provider webhook secret; Inngest signing key). The web app manifest,
 * its icons and the service worker are public too: browsers fetch the manifest
 * and icons without cookies, so behind the sign-in redirect the app could not be
 * installed. They hold nothing personal.
 */
export function isPublicPath(pathname: string): boolean {
  return (
    pathname === "/sign-in" ||
    pathname === "/auth" ||
    pathname.startsWith("/auth/") ||
    pathname.startsWith("/api/webhooks/") ||
    pathname === "/api/inngest" ||
    pathname === "/manifest.webmanifest" ||
    pathname === "/sw.js" ||
    pathname.startsWith("/icons/")
  );
}
