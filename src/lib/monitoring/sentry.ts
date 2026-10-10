// The only module that imports @sentry/nextjs. Server-side only: the browser
// never loads Sentry and is never given the DSN.
import * as Sentry from "@sentry/nextjs";
import { sanitizeDetails, scrubEvent, type Details } from "./scrub";
import type { IssueKind, Monitor } from "./types";

type SentryApi = Pick<
  typeof Sentry,
  "init" | "captureException" | "captureMessage"
>;

/** The options Sentry is started with; exported so a test can check them. */
export function sentryOptions(dsn: string, environment: string) {
  return {
    dsn,
    environment,
    // Collect nothing about requests, users or variables (Sentry 11 collects
    // all of it by default). beforeSend strips whatever slips through.
    dataCollection: {
      userInfo: false,
      cookies: false,
      httpHeaders: false,
      httpBodies: [],
      urlQueryParams: false,
      graphQL: { document: false, variables: false },
      genAI: { inputs: false, outputs: false },
      databaseQueryData: false,
      queues: false,
      stackFrameVariables: false,
    },
    // Errors only: no performance tracing, no request breadcrumbs.
    tracesSampleRate: 0,
    beforeBreadcrumb: () => null,
    beforeSend: scrubEvent,
  } satisfies Parameters<typeof Sentry.init>[0];
}

export class SentryMonitor implements Monitor {
  readonly name = "sentry";

  constructor(
    private readonly options: {
      dsn: string;
      environment: string;
      sentry?: SentryApi;
    },
  ) {}

  private get sentry(): SentryApi {
    return this.options.sentry ?? Sentry;
  }

  /** Starts the SDK. Called once per server process (instrumentation.ts). */
  init(): void {
    this.sentry.init(sentryOptions(this.options.dsn, this.options.environment));
  }

  reportIssue(kind: IssueKind, details?: Details): void {
    this.sentry.captureMessage(`wayfind: ${kind}`, {
      level: "warning",
      tags: { kind },
      // One Sentry issue per kind, however many times it happens.
      fingerprint: [kind],
      contexts: { wayfind: sanitizeDetails(details) },
    });
  }

  reportError(error: unknown, details?: Details): void {
    this.sentry.captureException(error, {
      contexts: { wayfind: sanitizeDetails(details) },
    });
  }
}
