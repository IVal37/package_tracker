// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  requireUser: vi.fn(),
  buildUserExport: vi.fn(),
  hit: vi.fn(),
}));

vi.mock("@/lib/auth/session", () => ({ requireUser: mocks.requireUser }));
vi.mock("@/lib/db/client", () => ({ getDb: () => "db" }));
vi.mock("@/lib/env", () => ({
  getEnv: () => ({ INBOUND_EMAIL_DOMAIN: "in.example.test" }),
}));
vi.mock("@/lib/privacy/export", () => ({
  buildUserExport: mocks.buildUserExport,
}));
vi.mock("@/lib/ratelimit", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/ratelimit")>()),
  hit: mocks.hit,
}));

import { LIMITS } from "@/lib/ratelimit";
import { GET } from "./route";

beforeEach(() => {
  vi.clearAllMocks();
  mocks.requireUser.mockResolvedValue({
    id: "session-user",
    email: "a@x.test",
  });
  mocks.hit.mockResolvedValue({ allowed: true, retryAfterSeconds: 0 });
  mocks.buildUserExport.mockResolvedValue({ format: "wayfind-export-1" });
  vi.spyOn(console, "warn").mockImplementation(() => {});
});

describe("GET /settings/export", () => {
  it("sends the session user's data as a download that is never cached", async () => {
    const response = await GET();

    expect(response.status).toBe(200);
    expect(response.headers.get("Content-Type")).toBe(
      "application/json; charset=utf-8",
    );
    expect(response.headers.get("Content-Disposition")).toMatch(
      /^attachment; filename="wayfind-data-\d{4}-\d{2}-\d{2}\.json"$/,
    );
    expect(response.headers.get("Cache-Control")).toBe("no-store");
    expect(await response.json()).toEqual({ format: "wayfind-export-1" });
    expect(mocks.buildUserExport).toHaveBeenCalledWith({
      db: "db",
      userId: "session-user",
      inboundDomain: "in.example.test",
      now: expect.any(Date),
    });
    expect(mocks.hit).toHaveBeenCalledWith(
      "db",
      LIMITS.exportData,
      "session-user",
      expect.any(Date),
    );
  });

  it("answers 429 over the limit and builds nothing", async () => {
    mocks.hit.mockResolvedValue({ allowed: false, retryAfterSeconds: 1200 });
    const response = await GET();
    expect(response.status).toBe(429);
    expect(response.headers.get("Retry-After")).toBe("1200");
    expect(mocks.buildUserExport).not.toHaveBeenCalled();
  });

  it("sends a signed-out caller to sign in", async () => {
    mocks.requireUser.mockRejectedValue(new Error("NEXT_REDIRECT /sign-in"));
    await expect(GET()).rejects.toThrow("NEXT_REDIRECT /sign-in");
    expect(mocks.buildUserExport).not.toHaveBeenCalled();
  });
});
