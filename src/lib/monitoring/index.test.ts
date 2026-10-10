// @vitest-environment node
import { afterEach, describe, expect, it, vi } from "vitest";
import { resetEnvCache } from "@/lib/env";
import { stubRequiredEnv } from "../../../tests/env";
import {
  createMonitor,
  getMonitor,
  reportError,
  reportIssue,
  resetMonitorCache,
  startMonitoring,
} from "./index";
import { NoopMonitor } from "./noop";
import { SentryMonitor, sentryOptions } from "./sentry";

const DSN = "https://key@o1.ingest.sentry.io/2";
const UUID = "3f2b8c1e-9a4d-4e6f-8b2a-1c3d5e7f9a0b";

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllEnvs();
  resetEnvCache();
  resetMonitorCache();
});

const fakeSentry = () => ({
  init: vi.fn(),
  captureException: vi.fn(),
  captureMessage: vi.fn(),
});

describe("createMonitor", () => {
  it("uses Sentry only when a DSN is set", () => {
    expect(createMonitor({ NODE_ENV: "production" }).name).toBe("noop");
    expect(
      createMonitor({ NODE_ENV: "production", SENTRY_DSN: DSN }).name,
    ).toBe("sentry");
  });
});

describe("getMonitor", () => {
  it("is chosen by the environment and cached", () => {
    stubRequiredEnv({ SENTRY_DSN: DSN });
    resetEnvCache();
    expect(getMonitor()).toBeInstanceOf(SentryMonitor);
    expect(getMonitor()).toBe(getMonitor());
  });

  it("falls back to the no-op monitor when the env is broken", () => {
    vi.stubEnv("DATABASE_URL", "not-a-url");
    resetEnvCache();
    expect(getMonitor()).toBeInstanceOf(NoopMonitor);
  });

  it("starts nothing without a DSN", () => {
    stubRequiredEnv();
    resetEnvCache();
    expect(() => startMonitoring()).not.toThrow();
    expect(getMonitor().name).toBe("noop");
  });
});

describe("SentryMonitor", () => {
  it("starts Sentry collecting nothing personal and scrubbing every event", () => {
    const sentry = fakeSentry();
    new SentryMonitor({ dsn: DSN, environment: "production", sentry }).init();
    const options = sentry.init.mock.calls[0]?.[0];
    expect(options).toMatchObject({
      dsn: DSN,
      environment: "production",
      tracesSampleRate: 0,
      dataCollection: {
        userInfo: false,
        cookies: false,
        httpHeaders: false,
        httpBodies: [],
        urlQueryParams: false,
        databaseQueryData: false,
        stackFrameVariables: false,
      },
    });
    expect(options.beforeBreadcrumb()).toBeNull();
    expect(
      options.beforeSend({ type: undefined, user: { email: "a@b.test" } }),
    ).toEqual({ type: undefined });
  });

  it("reports an issue as one grouped warning with sanitized details", () => {
    const sentry = fakeSentry();
    new SentryMonitor({ dsn: DSN, environment: "test", sentry }).reportIssue(
      "notification_failed",
      { notification_id: UUID, subject: "Red Shoes for jane@example.test" },
    );
    expect(sentry.captureMessage).toHaveBeenCalledExactlyOnceWith(
      "wayfind: notification_failed",
      {
        level: "warning",
        tags: { kind: "notification_failed" },
        fingerprint: ["notification_failed"],
        contexts: {
          wayfind: { notification_id: UUID, subject: "[redacted]" },
        },
      },
    );
  });

  it("reports an error with sanitized details", () => {
    const sentry = fakeSentry();
    const error = new Error("boom");
    new SentryMonitor({ dsn: DSN, environment: "test", sentry }).reportError(
      error,
      { route_type: "render" },
    );
    expect(sentry.captureException).toHaveBeenCalledExactlyOnceWith(error, {
      contexts: { wayfind: { route_type: "render" } },
    });
  });

  it("has options a real Sentry accepts", () => {
    expect(sentryOptions(DSN, "test").dsn).toBe(DSN);
  });
});

describe("NoopMonitor", () => {
  it("logs the kind and sanitized details only", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    new NoopMonitor().reportIssue("email_failed", {
      email_id: UUID,
      subject: "Hi jane@example.test",
    });
    expect(warn).toHaveBeenCalledWith("[monitor] issue", {
      kind: "email_failed",
      email_id: UUID,
      subject: "[redacted]",
    });
  });

  it("logs an error's class, never its message", () => {
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    new NoopMonitor().reportError(new TypeError("for jane@example.test"));
    new NoopMonitor().reportError("a string");
    expect(JSON.stringify(error.mock.calls)).not.toContain("jane");
    expect(error).toHaveBeenCalledWith("[monitor] error", {
      error: "TypeError",
    });
    expect(error).toHaveBeenCalledWith("[monitor] error", { error: "unknown" });
  });
});

describe("reportIssue and reportError", () => {
  it("go to the chosen monitor", () => {
    stubRequiredEnv();
    resetEnvCache();
    const issue = vi.spyOn(NoopMonitor.prototype, "reportIssue");
    const error = vi.spyOn(NoopMonitor.prototype, "reportError");
    vi.spyOn(console, "warn").mockImplementation(() => {});
    vi.spyOn(console, "error").mockImplementation(() => {});

    reportIssue("refetch_stopped", { reason: "quota" });
    reportError(new Error("x"));

    expect(issue).toHaveBeenCalledWith("refetch_stopped", { reason: "quota" });
    expect(error).toHaveBeenCalledOnce();
  });

  it("never throw, even when the monitor does", () => {
    stubRequiredEnv();
    resetEnvCache();
    vi.spyOn(NoopMonitor.prototype, "reportIssue").mockImplementation(() => {
      throw new Error("monitor down");
    });
    vi.spyOn(NoopMonitor.prototype, "reportError").mockImplementation(() => {
      throw new Error("monitor down");
    });
    expect(() => reportIssue("client_error")).not.toThrow();
    expect(() => reportError(new Error("x"))).not.toThrow();
  });
});
