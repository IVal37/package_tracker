// Response headers for every page. Pure, so next.config.ts and the tests use
// the same definition. Relative imports only: next.config.ts loads this
// outside Next's "@/" alias.
import { MAP_STYLE_URL } from "../geo/map-style";

/** The map style, its tiles, glyphs and sprites all come from this origin. */
export const MAP_ORIGIN = new URL(MAP_STYLE_URL).origin;

/**
 * What the app really loads:
 * - scripts from this site, plus Next's inline hydration scripts (and eval in
 *   development, for React's dev tools and fast refresh);
 * - styles from this site and inline (React style props, MapLibre);
 * - the map from MAP_ORIGIN, as fetches and as images, with MapLibre's worker
 *   from this site (and blob: for its fallback);
 * - nothing framed, no plugins, no other origin to post to or base on.
 * Supabase, Ship24, Resend and the rest are called from the server only, so
 * they are not here.
 */
export function contentSecurityPolicy(options: { dev: boolean }): string {
  const directives: Record<string, string[]> = {
    "default-src": ["'self'"],
    "script-src": [
      "'self'",
      "'unsafe-inline'",
      ...(options.dev ? ["'unsafe-eval'"] : []),
    ],
    "style-src": ["'self'", "'unsafe-inline'"],
    "img-src": ["'self'", "data:", "blob:", MAP_ORIGIN],
    "font-src": ["'self'", "data:"],
    "connect-src": [
      "'self'",
      MAP_ORIGIN,
      // Next's dev server pushes updates over a websocket.
      ...(options.dev ? ["ws:"] : []),
    ],
    "worker-src": ["'self'", "blob:"],
    "manifest-src": ["'self'"],
    "object-src": ["'none'"],
    "base-uri": ["'self'"],
    "frame-ancestors": ["'none'"],
  };
  return Object.entries(directives)
    .map(([name, values]) => `${name} ${values.join(" ")}`)
    .join("; ");
}

export function securityHeaders(options: {
  dev: boolean;
}): { key: string; value: string }[] {
  return [
    {
      key: "Strict-Transport-Security",
      value: "max-age=63072000; includeSubDomains",
    },
    { key: "X-Content-Type-Options", value: "nosniff" },
    { key: "X-Frame-Options", value: "DENY" },
    { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
    {
      key: "Permissions-Policy",
      value: "camera=(), microphone=(), geolocation=(), payment=(), usb=()",
    },
    {
      key: "Content-Security-Policy",
      value: contentSecurityPolicy(options),
    },
  ];
}
