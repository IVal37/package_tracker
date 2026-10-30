// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  requireUser: vi.fn(),
  requireLiveAccount: vi.fn(),
  addShipment: vi.fn(),
  removeShipment: vi.fn(),
  dismissOrder: vi.fn(),
  revalidatePath: vi.fn(),
  requestGeocoding: vi.fn(),
  hitAddPackage: vi.fn(),
  answerSetup: vi.fn(),
  logLimited: vi.fn(),
  redirect: vi.fn((path: string) => {
    throw new Error(`NEXT_REDIRECT ${path}`);
  }),
  db: { marker: "db" },
  provider: { marker: "provider" },
}));

vi.mock("@/jobs/events", () => ({
  requestGeocoding: mocks.requestGeocoding,
}));
vi.mock("@/lib/auth/session", () => ({ requireUser: mocks.requireUser }));
vi.mock("@/lib/ratelimit", () => ({
  hitAddPackage: mocks.hitAddPackage,
  logLimited: mocks.logLimited,
}));
vi.mock("@/lib/setup/answer", () => ({ answerSetup: mocks.answerSetup }));
vi.mock("@/lib/db/client", () => ({ getDb: () => mocks.db }));
vi.mock("@/lib/db/orders", () => ({ dismissOrder: mocks.dismissOrder }));
vi.mock("@/lib/auth/account", () => ({
  requireLiveAccount: mocks.requireLiveAccount,
}));
vi.mock("@/lib/env", () => ({ getEnv: () => ({ ACTIVE_PACKAGE_CAP: 7 }) }));
vi.mock("@/lib/shipments/add-shipment", () => ({
  addShipment: mocks.addShipment,
}));
vi.mock("@/lib/shipments/delete-shipment", () => ({
  removeShipment: mocks.removeShipment,
}));
vi.mock("@/lib/tracking", () => ({
  getTrackingProvider: () => mocks.provider,
}));
vi.mock("next/cache", () => ({ revalidatePath: mocks.revalidatePath }));
vi.mock("next/navigation", () => ({ redirect: mocks.redirect }));

import {
  addPackageAction,
  completeSetupAction,
  deletePackageAction,
  dismissOrderAction,
  skipSetupAction,
} from "./actions";

const USER = { id: "session-user", email: "a@example.test" };

const form = (fields: Record<string, string>) => {
  const data = new FormData();
  for (const [key, value] of Object.entries(fields)) data.set(key, value);
  return data;
};

beforeEach(() => {
  vi.clearAllMocks();
  mocks.requireUser.mockResolvedValue(USER);
  mocks.hitAddPackage.mockResolvedValue({
    allowed: true,
    retryAfterSeconds: 0,
  });
});

describe("addPackageAction", () => {
  it("redirects an unauthenticated caller and does nothing else", async () => {
    mocks.requireUser.mockRejectedValue(new Error("NEXT_REDIRECT /sign-in"));
    await expect(
      addPackageAction(
        { status: "idle" },
        form({ trackingNumber: "ABC12345" }),
      ),
    ).rejects.toThrow("NEXT_REDIRECT /sign-in");
    expect(mocks.addShipment).not.toHaveBeenCalled();
    expect(mocks.requireLiveAccount).not.toHaveBeenCalled();
  });

  it("refuses when the add limit is reached, before any provider call", async () => {
    mocks.hitAddPackage.mockResolvedValue({
      allowed: false,
      retryAfterSeconds: 30,
    });

    const state = await addPackageAction(
      { status: "idle" },
      form({ trackingNumber: "ABC12345", nickname: "Boots" }),
    );

    expect(state).toEqual({
      status: "error",
      error: "rate_limited",
      fieldErrors: {},
      values: { trackingNumber: "ABC12345", nickname: "Boots" },
    });
    expect(mocks.hitAddPackage).toHaveBeenCalledWith(
      mocks.db,
      "session-user",
      expect.any(Date),
    );
    expect(mocks.addShipment).not.toHaveBeenCalled();
    expect(mocks.revalidatePath).not.toHaveBeenCalled();
  });

  it("sends a deleted account's session to be signed out and adds nothing", async () => {
    mocks.requireLiveAccount.mockRejectedValueOnce(
      new Error("NEXT_REDIRECT /auth/ended"),
    );
    await expect(
      addPackageAction(
        { status: "idle" },
        form({ trackingNumber: "ABC12345" }),
      ),
    ).rejects.toThrow("NEXT_REDIRECT /auth/ended");
    expect(mocks.addShipment).not.toHaveBeenCalled();
  });

  it("uses the session user id, never one supplied in the form", async () => {
    mocks.addShipment.mockResolvedValue({ ok: true, shipmentId: "s1" });

    await addPackageAction(
      { status: "idle" },
      form({
        trackingNumber: "ABC12345",
        nickname: "Boots",
        userId: "someone-else",
        user_id: "someone-else",
      }),
    );

    expect(mocks.addShipment).toHaveBeenCalledWith({
      db: mocks.db,
      provider: mocks.provider,
      userId: "session-user",
      input: { trackingNumber: "ABC12345", nickname: "Boots" },
      activeCap: 7,
    });
    expect(mocks.requireLiveAccount).toHaveBeenCalledWith(mocks.db, USER);
  });

  it("revalidates the list and returns success when added", async () => {
    mocks.addShipment.mockResolvedValue({ ok: true, shipmentId: "s1" });
    const state = await addPackageAction(
      { status: "idle" },
      form({ trackingNumber: "ABC12345" }),
    );
    expect(state).toEqual({ status: "success" });
    expect(mocks.revalidatePath).toHaveBeenCalledWith("/");
  });

  it("asks for geocoding after a successful add", async () => {
    mocks.addShipment.mockResolvedValue({ ok: true, shipmentId: "s1" });
    await addPackageAction(
      { status: "idle" },
      form({ trackingNumber: "ABC12345" }),
    );
    expect(mocks.requestGeocoding).toHaveBeenCalledOnce();
  });

  it("does not ask for geocoding when the add fails", async () => {
    mocks.addShipment.mockResolvedValue({ ok: false, error: "duplicate" });
    await addPackageAction(
      { status: "idle" },
      form({ trackingNumber: "ABC12345" }),
    );
    expect(mocks.requestGeocoding).not.toHaveBeenCalled();
  });

  it("returns the error state with the typed values and does not revalidate", async () => {
    mocks.addShipment.mockResolvedValue({ ok: false, error: "duplicate" });
    const state = await addPackageAction(
      { status: "idle" },
      form({ trackingNumber: "ABC12345", nickname: "Boots" }),
    );
    expect(state).toEqual({
      status: "error",
      error: "duplicate",
      fieldErrors: {},
      values: { trackingNumber: "ABC12345", nickname: "Boots" },
    });
    expect(mocks.revalidatePath).not.toHaveBeenCalled();
  });

  it("treats missing form fields as empty strings", async () => {
    mocks.addShipment.mockResolvedValue({
      ok: false,
      error: "invalid",
      fieldErrors: { trackingNumber: "Too short" },
    });
    await addPackageAction({ status: "idle" }, new FormData());
    expect(mocks.addShipment).toHaveBeenCalledWith(
      expect.objectContaining({ input: { trackingNumber: "", nickname: "" } }),
    );
  });
});

describe("deletePackageAction", () => {
  it("redirects an unauthenticated caller and does nothing else", async () => {
    mocks.requireUser.mockRejectedValue(new Error("NEXT_REDIRECT /sign-in"));
    await expect(
      deletePackageAction(form({ shipmentId: "s1" })),
    ).rejects.toThrow("NEXT_REDIRECT /sign-in");
    expect(mocks.removeShipment).not.toHaveBeenCalled();
  });

  it("deletes as the session user, revalidates and returns to the list", async () => {
    mocks.removeShipment.mockResolvedValue({ ok: true });

    await expect(
      deletePackageAction(form({ shipmentId: "s1", userId: "someone-else" })),
    ).rejects.toThrow("NEXT_REDIRECT /");

    expect(mocks.removeShipment).toHaveBeenCalledWith({
      db: mocks.db,
      provider: mocks.provider,
      userId: "session-user",
      shipmentId: "s1",
    });
    expect(mocks.revalidatePath).toHaveBeenCalledWith("/");
  });

  it("passes an empty id through when the field is missing", async () => {
    mocks.removeShipment.mockResolvedValue({ ok: false, error: "not_found" });
    await expect(deletePackageAction(new FormData())).rejects.toThrow(
      "NEXT_REDIRECT /",
    );
    expect(mocks.removeShipment).toHaveBeenCalledWith(
      expect.objectContaining({ shipmentId: "" }),
    );
  });
});

describe("dismissOrderAction", () => {
  it("redirects an unauthenticated caller and does nothing else", async () => {
    mocks.requireUser.mockRejectedValue(new Error("NEXT_REDIRECT /sign-in"));
    await expect(dismissOrderAction(form({ orderId: "o1" }))).rejects.toThrow(
      "NEXT_REDIRECT /sign-in",
    );
    expect(mocks.dismissOrder).not.toHaveBeenCalled();
  });

  it("dismisses as the session user, ignoring any user id in the form", async () => {
    mocks.dismissOrder.mockResolvedValue(true);

    await dismissOrderAction(
      form({ orderId: "o1", userId: "someone-else", user_id: "someone-else" }),
    );

    expect(mocks.dismissOrder).toHaveBeenCalledExactlyOnceWith(
      mocks.db,
      "session-user",
      "o1",
    );
    expect(mocks.revalidatePath).toHaveBeenCalledWith("/");
  });

  it("passes an empty id through when the field is missing", async () => {
    mocks.dismissOrder.mockResolvedValue(false);
    await dismissOrderAction(new FormData());
    expect(mocks.dismissOrder).toHaveBeenCalledWith(
      mocks.db,
      "session-user",
      "",
    );
  });
});

describe.each([
  ["completeSetupAction", completeSetupAction, "completed"],
  ["skipSetupAction", skipSetupAction, "skipped"],
] as const)("%s", (_name, action, answer) => {
  beforeEach(() => {
    mocks.answerSetup.mockResolvedValue("saved");
  });

  it("redirects an unauthenticated caller and saves nothing", async () => {
    mocks.requireUser.mockRejectedValue(new Error("NEXT_REDIRECT /sign-in"));
    await expect(action()).rejects.toThrow("NEXT_REDIRECT /sign-in");
    expect(mocks.answerSetup).not.toHaveBeenCalled();
  });

  it("signs out a deleted account's session instead of saving", async () => {
    mocks.requireLiveAccount.mockRejectedValueOnce(
      new Error("NEXT_REDIRECT /auth/ended"),
    );
    await expect(action()).rejects.toThrow("NEXT_REDIRECT /auth/ended");
    expect(mocks.answerSetup).not.toHaveBeenCalled();
  });

  it("saves the answer for the session user and refreshes the pages", async () => {
    await action();
    expect(mocks.answerSetup).toHaveBeenCalledExactlyOnceWith({
      db: mocks.db,
      userId: "session-user",
      answer,
      now: expect.any(Date),
    });
    expect(mocks.revalidatePath).toHaveBeenCalledWith("/");
    expect(mocks.revalidatePath).toHaveBeenCalledWith("/setup");
  });

  it("logs the action name only when the limit refuses", async () => {
    mocks.answerSetup.mockResolvedValue("rate_limited");
    await action();
    expect(mocks.logLimited).toHaveBeenCalledExactlyOnceWith("setup-answer");
  });
});
