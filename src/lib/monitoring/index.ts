// Error reporting. Import only from here: the Sentry adapter is chosen by
// SENTRY_DSN, like the tracking provider and the senders, and nothing else
// imports @sentry/nextjs.
import { getEnv } from "@/lib/env";
import { NoopMonitor } from "./noop";
import type { Details } from "./scrub";
import { SentryMonitor } from "./sentry";
import type { IssueKind, Monitor } from "./types";

export { redactText, sanitizeDetails, scrubEvent } from "./scrub";
export type { Details } from "./scrub";
export type { IssueKind, Monitor } from "./types";

/** Pure: the monitor an env asks for. */
export function createMonitor(env: {
  SENTRY_DSN?: string;
  NODE_ENV: string;
}): Monitor {
  return env.SENTRY_DSN
    ? new SentryMonitor({ dsn: env.SENTRY_DSN, environment: env.NODE_ENV })
    : new NoopMonitor();
}

let cached: Monitor | undefined;

/** Lazy per-process singleton chosen by SENTRY_DSN. */
export function getMonitor(): Monitor {
  if (!cached) {
    try {
      cached = createMonitor(getEnv());
    } catch {
      // A broken env must not hide the error being reported.
      cached = new NoopMonitor();
    }
  }
  return cached;
}

/** Starts error reporting for this server process. Safe to call more than once. */
export function startMonitoring(): void {
  const monitor = getMonitor();
  if (monitor instanceof SentryMonitor) monitor.init();
}

/** Test helper: forget the cached monitor. */
export function resetMonitorCache(): void {
  cached = undefined;
}

/** Reports a problem that is not an exception. Never throws. */
export function reportIssue(kind: IssueKind, details?: Details): void {
  try {
    getMonitor().reportIssue(kind, details);
  } catch {
    // Reporting must never break the work that hit the problem.
  }
}

/** Reports an exception. Never throws. */
export function reportError(error: unknown, details?: Details): void {
  try {
    getMonitor().reportError(error, details);
  } catch {
    // Reporting must never break the work that hit the problem.
  }
}
