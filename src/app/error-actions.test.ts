// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  reportIssue: vi.fn(),
  hit: vi.fn(),
  headers: new Headers({ "x-real-ip": "203.0.113.4" }),
}));

vi.mock("next/headers", () => ({ headers: async () => mocks.headers }));
vi.mock("@/lib/db/client", () => ({ getDb: () => "db" }));
vi.mock("@/lib/monitoring", () => ({ reportIssue: mocks.reportIssue }));
vi.mock("@/lib/ratelimit", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/ratelimit")>()),
  hit: mocks.hit,
}));

import { LIMITS } from "@/lib/ratelimit";
import { reportClientErrorAction } from "./error-actions";

beforeEach(() => {
  mocks.reportIssue.mockReset();
  mocks.hit.mockReset();
  mocks.hit.mockResolvedValue({ allowed: true, retryAfterSeconds: 0 });
});

describe("reportClientErrorAction", () => {
  it("reports the error's class name only, limited per client IP", async () => {
    await reportClientErrorAction("TypeError");
    expect(mocks.hit).toHaveBeenCalledWith(
      "db",
      LIMITS.clientError,
      "203.0.113.4",
      expect.any(Date),
    );
    expect(mocks.reportIssue).toHaveBeenCalledExactlyOnceWith("client_error", {
      error: "typeerror",
    });
  });

  it.each([
    "Error: jane@example.test",
    "1Z999AA10123456784",
    42,
    null,
    "x".repeat(41),
  ])("never passes on a name like %j", async (name) => {
    await reportClientErrorAction(name);
    expect(mocks.reportIssue).toHaveBeenCalledExactlyOnceWith("client_error", {
      error: "unknown",
    });
  });

  it("reports nothing over the limit", async () => {
    mocks.hit.mockResolvedValue({ allowed: false, retryAfterSeconds: 60 });
    await reportClientErrorAction("TypeError");
    expect(mocks.reportIssue).not.toHaveBeenCalled();
  });
});
