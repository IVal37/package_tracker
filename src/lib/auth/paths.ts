/** Paths reachable without a session. Everything else requires sign-in. */
export function isPublicPath(pathname: string): boolean {
  return (
    pathname === "/sign-in" ||
    pathname === "/auth" ||
    pathname.startsWith("/auth/")
  );
}
