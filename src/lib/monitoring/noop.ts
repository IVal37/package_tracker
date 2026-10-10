import { sanitizeDetails, type Details } from "./scrub";
import type { IssueKind, Monitor } from "./types";

/**
 * Used when SENTRY_DSN is not set (development and tests): nothing leaves the
 * server, and the problem is logged with the same sanitized details.
 */
export class NoopMonitor implements Monitor {
  readonly name = "noop";

  reportIssue(kind: IssueKind, details?: Details): void {
    console.warn("[monitor] issue", { kind, ...sanitizeDetails(details) });
  }

  reportError(error: unknown, details?: Details): void {
    console.error("[monitor] error", {
      error: error instanceof Error ? error.name : "unknown",
      ...sanitizeDetails(details),
    });
  }
}
