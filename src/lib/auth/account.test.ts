// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  refreshUserEmail: vi.fn(),
  redirect: vi.fn((path: string) => {
    throw new Error(`NEXT_REDIRECT ${path}`);
  }),
  db: { marker: "db" },
}));

vi.mock("@/lib/db/users", () => ({ refreshUserEmail: mocks.refreshUserEmail }));
vi.mock("next/navigation", () => ({ redirect: mocks.redirect }));

import { ENDED_SESSION_PATH, requireLiveAccount } from "./account";

const USER = { id: "session-user", email: "a@example.test" };

beforeEach(() => {
  vi.clearAllMocks();
});

describe("requireLiveAccount", () => {
  it("returns when the account's row exists, after refreshing its email", async () => {
    mocks.refreshUserEmail.mockResolvedValue(true);
    await expect(
      requireLiveAccount(mocks.db as never, USER),
    ).resolves.toBeUndefined();
    expect(mocks.refreshUserEmail).toHaveBeenCalledWith(mocks.db, USER);
    expect(mocks.redirect).not.toHaveBeenCalled();
  });

  it("sends a session whose account is gone to be signed out", async () => {
    mocks.refreshUserEmail.mockResolvedValue(false);
    await expect(requireLiveAccount(mocks.db as never, USER)).rejects.toThrow(
      `NEXT_REDIRECT ${ENDED_SESSION_PATH}`,
    );
    expect(ENDED_SESSION_PATH).toBe("/auth/ended");
  });
});
