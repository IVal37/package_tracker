// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  requireUser: vi.fn(),
  rotateAlias: vi.fn(),
  revalidatePath: vi.fn(),
  db: { marker: "db" },
}));

vi.mock("@/lib/auth/session", () => ({ requireUser: mocks.requireUser }));
vi.mock("@/lib/db/client", () => ({ getDb: () => mocks.db }));
vi.mock("@/lib/db/forwarding", () => ({ rotateAlias: mocks.rotateAlias }));
vi.mock("next/cache", () => ({ revalidatePath: mocks.revalidatePath }));

import { regenerateAddressAction } from "./actions";

beforeEach(() => {
  vi.clearAllMocks();
  mocks.requireUser.mockResolvedValue({
    id: "session-user",
    email: "a@example.test",
  });
});

describe("regenerateAddressAction", () => {
  it("redirects an unauthenticated caller and rotates nothing", async () => {
    mocks.requireUser.mockRejectedValue(new Error("NEXT_REDIRECT /sign-in"));
    await expect(regenerateAddressAction()).rejects.toThrow(
      "NEXT_REDIRECT /sign-in",
    );
    expect(mocks.rotateAlias).not.toHaveBeenCalled();
  });

  it("rotates the session user's alias and refreshes the page", async () => {
    mocks.rotateAlias.mockResolvedValue("new-alias");
    await regenerateAddressAction();

    expect(mocks.rotateAlias).toHaveBeenCalledExactlyOnceWith(
      mocks.db,
      "session-user",
    );
    expect(mocks.revalidatePath).toHaveBeenCalledWith("/settings");
  });

  it("takes no input, so no form field can name another user", () => {
    expect(regenerateAddressAction.length).toBe(0);
  });
});
