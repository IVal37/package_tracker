// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  startMonitoring: vi.fn(),
  reportError: vi.fn(),
}));

vi.mock("@/lib/monitoring", () => mocks);

import { onRequestError, register } from "./instrumentation";

const request = {
  path: "/settings?code=secret",
  method: "POST",
  headers: { cookie: "sb-access-token=secret" },
};
const context = {
  routerKind: "App Router" as const,
  routePath: "/settings",
  routeType: "action" as const,
  revalidateReason: undefined,
};

beforeEach(() => {
  mocks.startMonitoring.mockReset();
  mocks.reportError.mockReset();
});

afterEach(() => vi.unstubAllEnvs());

describe("register", () => {
  it("starts monitoring in the Node.js runtime", async () => {
    vi.stubEnv("NEXT_RUNTIME", "nodejs");
    await register();
    expect(mocks.startMonitoring).toHaveBeenCalledOnce();
  });

  it("does nothing in the edge runtime", async () => {
    vi.stubEnv("NEXT_RUNTIME", "edge");
    await register();
    expect(mocks.startMonitoring).not.toHaveBeenCalled();
  });
});

describe("onRequestError", () => {
  it("reports the error with the route's kind, never the request's path or headers", async () => {
    vi.stubEnv("NEXT_RUNTIME", "nodejs");
    const error = new Error("boom");
    await onRequestError(error, request, context);
    expect(mocks.reportError).toHaveBeenCalledExactlyOnceWith(error, {
      method: "post",
      route_type: "action",
      router: "app",
    });
    expect(JSON.stringify(mocks.reportError.mock.calls)).not.toContain(
      "secret",
    );
  });

  it("does nothing in the edge runtime", async () => {
    vi.stubEnv("NEXT_RUNTIME", "edge");
    await onRequestError(new Error("x"), request, {
      ...context,
      routerKind: "Pages Router",
    });
    expect(mocks.reportError).not.toHaveBeenCalled();
  });
});
