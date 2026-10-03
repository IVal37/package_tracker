// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  requireUser: vi.fn(),
  ensureUser: vi.fn(),
  addShipment: vi.fn(),
  removeShipment: vi.fn(),
  revalidatePath: vi.fn(),
  redirect: vi.fn((path: string) => {
    throw new Error(`NEXT_REDIRECT ${path}`);
  }),
  db: { marker: "db" },
  provider: { marker: "provider" },
}));

vi.mock("@/lib/auth/session", () => ({ requireUser: mocks.requireUser }));
vi.mock("@/lib/db/client", () => ({ getDb: () => mocks.db }));
vi.mock("@/lib/db/users", () => ({ ensureUser: mocks.ensureUser }));
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

import { addPackageAction, deletePackageAction } from "./actions";

const USER = { id: "session-user", email: "a@example.test" };

const form = (fields: Record<string, string>) => {
  const data = new FormData();
  for (const [key, value] of Object.entries(fields)) data.set(key, value);
  return data;
};

beforeEach(() => {
  vi.clearAllMocks();
  mocks.requireUser.mockResolvedValue(USER);
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
    expect(mocks.ensureUser).not.toHaveBeenCalled();
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
    });
    expect(mocks.ensureUser).toHaveBeenCalledWith(mocks.db, USER);
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
