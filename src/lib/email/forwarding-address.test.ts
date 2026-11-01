import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Db } from "@/lib/db/client";

const { requireLiveAccount, getOrCreateAlias } = vi.hoisted(() => ({
  requireLiveAccount: vi.fn(),
  getOrCreateAlias: vi.fn(),
}));
vi.mock("@/lib/auth/account", () => ({ requireLiveAccount }));
vi.mock("@/lib/db/forwarding", () => ({ getOrCreateAlias }));
vi.mock("@/lib/env", () => ({
  getEnv: () => ({ INBOUND_EMAIL_DOMAIN: "in.wayfind.test" }),
}));

import { loadForwardingAddress } from "./forwarding-address";

const db = {} as Db;
const user = { id: "user-1", email: "a@example.com" };

beforeEach(() => {
  requireLiveAccount.mockReset();
  getOrCreateAlias.mockReset();
});

describe("loadForwardingAddress", () => {
  it("builds the address from the user's alias", async () => {
    getOrCreateAlias.mockResolvedValue("ann-7f3k");
    expect(await loadForwardingAddress(db, user)).toBe(
      "ann-7f3k@in.wayfind.test",
    );
    expect(getOrCreateAlias).toHaveBeenCalledWith(db, "user-1");
  });

  it("is null when no alias could be made", async () => {
    getOrCreateAlias.mockResolvedValue(null);
    expect(await loadForwardingAddress(db, user)).toBeNull();
  });

  it("checks the account is live before touching the alias", async () => {
    requireLiveAccount.mockRejectedValue(new Error("NEXT_REDIRECT"));
    await expect(loadForwardingAddress(db, user)).rejects.toThrow(
      "NEXT_REDIRECT",
    );
    expect(getOrCreateAlias).not.toHaveBeenCalled();
  });
});
