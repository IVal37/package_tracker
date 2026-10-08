// @vitest-environment node
import { eq } from "drizzle-orm";
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  it,
  vi,
  type MockInstance,
} from "vitest";
import { createTestDb, insertUser } from "../../../../tests/db/pglite";
import { shipments } from "@/lib/db/schema";
import {
  ProviderAuthError,
  ProviderUnavailableError,
  QuotaExceededError,
  RateLimitedError,
  TrackerNotFoundError,
  createTrackingProvider,
  type TrackingProvider,
} from "@/lib/tracking";
import { refetchStaleShipments } from "./refetch-stale";

const NOW = new Date("2026-06-20T12:00:00Z");
const HOUR = 3_600_000;
const ago = (hours: number) => new Date(NOW.getTime() - hours * HOUR);

const provider = createTrackingProvider({
  TRACKING_PROVIDER: "fake",
  FAKE_WEBHOOK_SECRET: "s",
});

let ctx: Awaited<ReturnType<typeof createTestDb>>;
let userId: string;
let getTracking: MockInstance<TrackingProvider["getTracking"]>;

beforeEach(async () => {
  ctx = await createTestDb();
  userId = (await insertUser(ctx.db)).id;
  getTracking = vi.spyOn(provider, "getTracking");
  vi.spyOn(console, "warn").mockImplementation(() => {});
});

afterEach(async () => {
  vi.restoreAllMocks();
  await ctx.client.close();
});

let seq = 0;
async function add(
  trackerId: string | null,
  syncedHoursAgo: number,
  extra: Partial<typeof shipments.$inferInsert> = {},
) {
  const [row] = await ctx.db
    .insert(shipments)
    .values({
      userId,
      trackingNumber: `RF-${++seq}`,
      provider: "fake",
      providerTrackerId: trackerId,
      lastSyncedAt: ago(syncedHoursAgo),
      ...extra,
    })
    .returning();
  if (!row) throw new Error("insert failed");
  return row;
}

const reload = async (id: string) => {
  const [row] = await ctx.db
    .select()
    .from(shipments)
    .where(eq(shipments.id, id));
  if (!row) throw new Error("missing");
  return row;
};

const run = (limit = 100) =>
  refetchStaleShipments({ db: ctx.db, provider, now: NOW, limit });

describe("refetchStaleShipments", () => {
  it("fetches only stale trackers and applies what comes back", async () => {
    const stale = await add("fake:FAKE-OFD-1", 30);
    const fresh = await add("fake:FAKE-TRANSIT-2", 2);

    const result = await run();

    expect(getTracking).toHaveBeenCalledTimes(1);
    expect(getTracking).toHaveBeenCalledWith("fake:FAKE-OFD-1");
    expect(result).toEqual({
      checked: 1,
      updated: 1,
      failed: 0,
      stoppedEarly: false,
    });
    const updated = await reload(stale.id);
    expect(updated.status).toBe("OutForDelivery");
    expect(updated.lastSyncedAt).toEqual(NOW);
    expect((await reload(fresh.id)).lastSyncedAt).toEqual(ago(2));
  });

  it("skips archived, delivered, expired, other-provider and tracker-less shipments", async () => {
    await add("fake:FAKE-TRANSIT-1", 48, { archivedAt: ago(1) });
    await add("fake:FAKE-TRANSIT-2", 48, { status: "Delivered" });
    await add("fake:FAKE-TRANSIT-3", 48, { status: "Expired" });
    await add("fake:FAKE-TRANSIT-4", 48, { provider: "ship24" });
    await add(null, 48);

    const result = await run();

    expect(getTracking).not.toHaveBeenCalled();
    expect(result).toEqual({
      checked: 0,
      updated: 0,
      failed: 0,
      stoppedEarly: false,
    });
  });

  it("fetches a tracker shared by two shipments once and updates both", async () => {
    const other = (await insertUser(ctx.db)).id;
    const a = await add("fake:FAKE-OFD-5", 30);
    const [b] = await ctx.db
      .insert(shipments)
      .values({
        userId: other,
        trackingNumber: "RF-shared",
        provider: "fake",
        providerTrackerId: "fake:FAKE-OFD-5",
        lastSyncedAt: ago(30),
      })
      .returning();

    await run();

    expect(getTracking).toHaveBeenCalledTimes(1);
    expect((await reload(a.id)).status).toBe("OutForDelivery");
    expect((await reload(b!.id)).status).toBe("OutForDelivery");
  });

  it("goes oldest first and respects the limit", async () => {
    await add("fake:FAKE-TRANSIT-A", 30);
    await add("fake:FAKE-TRANSIT-B", 90);
    await add("fake:FAKE-TRANSIT-C", 60);

    await run(2);

    expect(getTracking.mock.calls.map(([id]) => id)).toEqual([
      "fake:FAKE-TRANSIT-B",
      "fake:FAKE-TRANSIT-C",
    ]);
  });

  it("is a no-op for a tracker that has nothing new, but still counts it as synced", async () => {
    const row = await add("fake:FAKE-OFD-6", 30);
    await run();
    // Make it stale again; the same events come back, so nothing is new.
    await ctx.db
      .update(shipments)
      .set({ lastSyncedAt: ago(40) })
      .where(eq(shipments.id, row.id));

    const second = await run();

    expect(second).toEqual({
      checked: 1,
      updated: 0,
      failed: 0,
      stoppedEarly: false,
    });
    expect((await reload(row.id)).lastSyncedAt).toEqual(NOW);
  });

  it("marks a permanently failing tracker synced and carries on", async () => {
    const broken = await add("fake:FAKE-TRANSIT-BROKEN", 90);
    const healthy = await add("fake:FAKE-OFD-7", 30);
    getTracking.mockRejectedValueOnce(new TrackerNotFoundError("gone"));

    const result = await run();

    expect(result).toEqual({
      checked: 2,
      updated: 1,
      failed: 1,
      stoppedEarly: false,
    });
    expect((await reload(broken.id)).lastSyncedAt).toEqual(NOW);
    expect((await reload(healthy.id)).status).toBe("OutForDelivery");
  });

  it.each([
    ["rate limiting", () => new RateLimitedError()],
    ["the provider being down", () => new ProviderUnavailableError()],
    ["a bad API key", () => new ProviderAuthError("401")],
    ["an exhausted quota", () => new QuotaExceededError("quota")],
  ])(
    "stops on %s and leaves everything stale for the next run",
    async (_name, makeError) => {
      const first = await add("fake:FAKE-TRANSIT-X", 90);
      const second = await add("fake:FAKE-TRANSIT-Y", 60);
      getTracking.mockRejectedValueOnce(makeError());

      const result = await run();

      expect(getTracking).toHaveBeenCalledTimes(1);
      expect(result).toEqual({
        checked: 0,
        updated: 0,
        failed: 0,
        stoppedEarly: true,
      });
      expect((await reload(first.id)).lastSyncedAt).toEqual(ago(90));
      expect((await reload(second.id)).lastSyncedAt).toEqual(ago(60));
    },
  );

  it("lets an unexpected error escape so the job retries", async () => {
    await add("fake:FAKE-TRANSIT-Z", 30);
    getTracking.mockRejectedValueOnce(new Error("socket hang up"));

    await expect(run()).rejects.toThrow("socket hang up");
  });

  it("logs only the error name for a failed tracker", async () => {
    await add("fake:FAKE-TRANSIT-LOG", 30);
    getTracking.mockRejectedValueOnce(
      new TrackerNotFoundError("secret-detail"),
    );

    await run();

    const logged = JSON.stringify(vi.mocked(console.warn).mock.calls);
    expect(logged).toContain("TrackerNotFoundError");
    expect(logged).not.toContain("secret-detail");
  });
});
