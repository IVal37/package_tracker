// Every rate limit in one place. Fixed windows: simple, shared through the
// database, and good enough to stop abuse (a burst across a window boundary can
// reach twice the limit, which is fine for these numbers).

const MINUTE_MS = 60_000;
const HOUR_MS = 60 * MINUTE_MS;
const DAY_MS = 24 * HOUR_MS;

export interface Limit {
  /** Names the action in keys and logs. */
  action: string;
  limit: number;
  windowMs: number;
}

export const LIMITS = {
  /** Sign-in links requested from one client IP. */
  signInIp: { action: "sign-in-ip", limit: 5, windowMs: 10 * MINUTE_MS },
  /** Sign-in links requested for one email address. */
  signInEmail: { action: "sign-in-email", limit: 5, windowMs: 10 * MINUTE_MS },
  addPackageMinute: {
    action: "add-package-minute",
    limit: 10,
    windowMs: MINUTE_MS,
  },
  addPackageDay: { action: "add-package-day", limit: 100, windowMs: DAY_MS },
  testPush: { action: "test-push", limit: 3, windowMs: MINUTE_MS },
  exportData: { action: "export-data", limit: 3, windowMs: HOUR_MS },
  deleteAccount: { action: "delete-account", limit: 3, windowMs: HOUR_MS },
  /** Emails to one forwarding alias (the daily cap applies as well). */
  inboundAlias: { action: "inbound-alias", limit: 10, windowMs: MINUTE_MS },
} as const satisfies Record<string, Limit>;

/** Circuit breakers (see tripBreaker): tripped for the rest of their window. */
export const BREAKERS = {
  /** The re-fetch met a bad API key or an exhausted quota: pause it this hour. */
  refetch: { action: "refetch-paused", limit: 0, windowMs: HOUR_MS },
} as const satisfies Record<string, Limit>;

/** Windows older than this are deleted by the daily cleanup (longer than any window). */
export const KEEP_WINDOWS_MS = 2 * DAY_MS;
