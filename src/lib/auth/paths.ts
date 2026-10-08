/**
 * Paths reachable without a session. Everything else requires sign-in.
 * The webhook and Inngest routes have no user: each authenticates the caller
 * itself (provider webhook secret; Inngest signing key).
 */
export function isPublicPath(pathname: string): boolean {
  return (
    pathname === "/sign-in" ||
    pathname === "/auth" ||
    pathname.startsWith("/auth/") ||
    pathname.startsWith("/api/webhooks/") ||
    pathname === "/api/inngest"
  );
}
