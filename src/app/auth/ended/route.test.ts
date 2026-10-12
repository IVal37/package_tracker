// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { isPublicPath } from "@/lib/auth/paths";
import { resetEnvCache } from "@/lib/env";
import { stubRequiredEnv } from "../../../../tests/env";

const mocks = vi.hoisted(() => ({
  getCurrentUser: vi.fn(),
  refreshUserEmail: vi.fn(),
  signOut: vi.fn(),
  db: { marker: "db" },
}));

vi.mock("@/lib/auth/session", () => ({ getCurrentUser: mocks.getCurrentUser }));
vi.mock("@/lib/db/users", () => ({ refreshUserEmail: mocks.refreshUserEmail }));
vi.mock("@/lib/db/client", () => ({ getDb: () => mocks.db }));
vi.mock("@/lib/auth/supabase-server", () => ({
  createSupabaseServerClient: async () => ({
    auth: { signOut: mocks.signOut },
  }),
}));

import { GET } from "./route";

const USER = { id: "session-user", email: "a@example.test" };
const APP = "https://wayfind.example.test";

beforeEach(() => {
  vi.clearAllMocks();
  mocks.signOut.mockResolvedValue({ error: null });
  stubRequiredEnv({ APP_URL: APP });
  resetEnvCache();
});

afterEach(() => {
  vi.unstubAllEnvs();
  resetEnvCache();
});

describe("GET /auth/ended", () => {
  it("is reachable without a live account", () => {
    expect(isPublicPath("/auth/ended")).toBe(true);
  });

  it("signs out a session whose account is gone and shows the deleted page", async () => {
    mocks.getCurrentUser.mockResolvedValue(USER);
    mocks.refreshUserEmail.mockResolvedValue(false);

    const response = await GET();

    expect(mocks.refreshUserEmail).toHaveBeenCalledWith(mocks.db, USER);
    expect(mocks.signOut).toHaveBeenCalledWith({ scope: "local" });
    expect(response.headers.get("location")).toBe(`${APP}/account-deleted`);
  });

  it("never signs out a live account; it just goes home", async () => {
    mocks.getCurrentUser.mockResolvedValue(USER);
    mocks.refreshUserEmail.mockResolvedValue(true);

    const response = await GET();

    expect(mocks.signOut).not.toHaveBeenCalled();
    expect(response.headers.get("location")).toBe(`${APP}/`);
  });

  it("sends a visitor with no session to sign in", async () => {
    mocks.getCurrentUser.mockResolvedValue(null);

    const response = await GET();

    expect(mocks.refreshUserEmail).not.toHaveBeenCalled();
    expect(mocks.signOut).not.toHaveBeenCalled();
    expect(response.headers.get("location")).toBe(`${APP}/sign-in`);
  });

  it("still leaves for the deleted page when signing out fails", async () => {
    mocks.getCurrentUser.mockResolvedValue(USER);
    mocks.refreshUserEmail.mockResolvedValue(false);
    mocks.signOut.mockRejectedValue(new Error("network"));

    const response = await GET();

    expect(response.headers.get("location")).toBe(`${APP}/account-deleted`);
  });
});
