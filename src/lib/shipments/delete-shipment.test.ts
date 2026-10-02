// @vitest-environment node
import {
  afterAll,
  afterEach,
  beforeAll,
  describe,
  expect,
  it,
  vi,
} from "vitest";
import { getShipment } from "@/lib/db/shipments";
import {
  ProviderUnavailableError,
  TrackerNotFoundError,
  createTrackingProvider,
  type TrackingProvider,
} from "@/lib/tracking";
import { createTestDb, insertUser } from "../../../tests/db/pglite";
import { addShipment } from "./add-shipment";
import { removeShipment } from "./delete-shipment";

let ctx: Awaited<ReturnType<typeof createTestDb>>;

beforeAll(async () => {
  ctx = await createTestDb();
});

afterAll(async () => {
  await ctx.client.close();
});

afterEach(() => {
  vi.restoreAllMocks();
});

const fake = createTrackingProvider({
  TRACKING_PROVIDER: "fake",
  FAKE_WEBHOOK_SECRET: "test-secret",
});

async function seed(userId: string, trackingNumber: string) {
  const result = await addShipment({
    db: ctx.db,
    provider: fake,
    userId,
    input: { trackingNumber },
  });
  if (!result.ok) throw new Error("seed failed");
  return result.shipmentId;
}

const remove = (
  userId: string,
  shipmentId: string,
  provider: TrackingProvider = fake,
) => removeShipment({ db: ctx.db, provider, userId, shipmentId });

describe("removeShipment", () => {
  it("unsubscribes at the provider and deletes the row", async () => {
    const user = await insertUser(ctx.db);
    const id = await seed(user.id, "FAKE-DEL-1");
    const spy = vi.spyOn(fake, "deleteTracking");

    await expect(remove(user.id, id)).resolves.toEqual({ ok: true });

    expect(spy).toHaveBeenCalledWith("fake:FAKE-DEL-1");
    expect(await getShipment(ctx.db, user.id, id)).toBeNull();
  });

  it("cannot delete another user's shipment, and never calls the provider", async () => {
    const a = await insertUser(ctx.db);
    const b = await insertUser(ctx.db);
    const id = await seed(a.id, "FAKE-OWNED-1");
    const spy = vi.spyOn(fake, "deleteTracking");

    await expect(remove(b.id, id)).resolves.toEqual({
      ok: false,
      error: "not_found",
    });

    expect(spy).not.toHaveBeenCalled();
    expect(await getShipment(ctx.db, a.id, id)).not.toBeNull();
  });

  it.each(["not-a-uuid", "99999999-9999-4999-8999-999999999999"])(
    "returns not_found for the id %s",
    async (id) => {
      const user = await insertUser(ctx.db);
      await expect(remove(user.id, id)).resolves.toEqual({
        ok: false,
        error: "not_found",
      });
    },
  );

  it("ignores a provider that no longer knows the tracker", async () => {
    const errorLog = vi.spyOn(console, "error").mockImplementation(() => {});
    const user = await insertUser(ctx.db);
    const id = await seed(user.id, "FAKE-GONE-1");
    vi.spyOn(fake, "deleteTracking").mockRejectedValue(
      new TrackerNotFoundError("404"),
    );

    await expect(remove(user.id, id)).resolves.toEqual({ ok: true });

    expect(errorLog).not.toHaveBeenCalled();
    expect(await getShipment(ctx.db, user.id, id)).toBeNull();
  });

  it("still deletes when the provider fails, and logs it", async () => {
    const errorLog = vi.spyOn(console, "error").mockImplementation(() => {});
    const user = await insertUser(ctx.db);
    const id = await seed(user.id, "FAKE-DOWN-1");
    vi.spyOn(fake, "deleteTracking").mockRejectedValue(
      new ProviderUnavailableError(),
    );

    await expect(remove(user.id, id)).resolves.toEqual({ ok: true });

    expect(errorLog).toHaveBeenCalledWith(
      expect.stringContaining("ProviderUnavailableError"),
    );
    expect(await getShipment(ctx.db, user.id, id)).toBeNull();
  });

  it("logs a non-Error provider failure without crashing", async () => {
    const errorLog = vi.spyOn(console, "error").mockImplementation(() => {});
    const user = await insertUser(ctx.db);
    const id = await seed(user.id, "FAKE-ODD-1");
    vi.spyOn(fake, "deleteTracking").mockRejectedValue("weird");

    await expect(remove(user.id, id)).resolves.toEqual({ ok: true });
    expect(errorLog).toHaveBeenCalledWith(expect.stringContaining("unknown"));
  });

  it("skips the provider call when the row came from a different provider", async () => {
    const user = await insertUser(ctx.db);
    const id = await seed(user.id, "FAKE-OLD-1");
    const otherProvider: TrackingProvider = {
      ...fake,
      name: "ship24",
      deleteTracking: vi.fn(),
    };

    await expect(remove(user.id, id, otherProvider)).resolves.toEqual({
      ok: true,
    });
    expect(otherProvider.deleteTracking).not.toHaveBeenCalled();
  });
});
