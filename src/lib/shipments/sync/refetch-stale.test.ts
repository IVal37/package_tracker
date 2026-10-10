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
import {
  buildRefetchEvents,
  findTrackersToRefetch,
  refetchTracker,
} from "./refetch-stale";

const NOW = new Date("2026-06-20T12:10:00Z");
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
  seq += 1;
  const [row] = await ctx.db
    .insert(shipments)
    .values({
      userId,
      trackingNumber: "RF-" + seq,
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

const find = (limit = 100, now = NOW) =>
  findTrackersToRefetch({ db: ctx.db, provider, now, limit });
const refetch = (trackerId: string, now = NOW) =>
  refetchTracker({ db: ctx.db, provider, trackerId, now });

describe("findTrackersToRefetch", () => {
  it("finds only stale trackers, oldest first, up to the limit", async () => {
    await add("fake:FAKE-TRANSIT-A", 30);
    await add("fake:FAKE-TRANSIT-B", 90);
    await add("fake:FAKE-TRANSIT-C", 60);
    await add("fake:FAKE-TRANSIT-FRESH", 2);

    expect(await find(2)).toEqual([
      "fake:FAKE-TRANSIT-B",
      "fake:FAKE-TRANSIT-C",
    ]);
  });

  it("skips archived, delivered, expired, other-provider and tracker-less shipments", async () => {
    await add("fake:FAKE-TRANSIT-1", 48, { archivedAt: ago(1) });
    await add("fake:FAKE-TRANSIT-2", 48, { status: "Delivered" });
    await add("fake:FAKE-TRANSIT-3", 48, { status: "Expired" });
    await add("fake:FAKE-TRANSIT-4", 48, { provider: "ship24" });
    await add(null, 48);
    expect(await find()).toEqual([]);
  });

  it("lists a tracker shared by two shipments once", async () => {
    const other = (await insertUser(ctx.db)).id;
    await add("fake:FAKE-OFD-5", 30);
    await add("fake:FAKE-OFD-5", 30, { userId: other });
    expect(await find()).toEqual(["fake:FAKE-OFD-5"]);
  });

  it("finds nothing while the re-fetch is paused, and resumes the next hour", async () => {
    await add("fake:FAKE-TRANSIT-P", 30);
    getTracking.mockRejectedValueOnce(new ProviderAuthError("401"));
    await refetch("fake:FAKE-TRANSIT-P");

    expect(await find()).toEqual([]);
    expect(await find(100, new Date(NOW.getTime() + HOUR))).toEqual([
      "fake:FAKE-TRANSIT-P",
    ]);
  });
});

describe("refetchTracker", () => {
  it("applies what comes back to the tracker's shipments", async () => {
    const stale = await add("fake:FAKE-OFD-1", 30);

    const result = await refetch("fake:FAKE-OFD-1");

    expect(getTracking).toHaveBeenCalledExactlyOnceWith("fake:FAKE-OFD-1");
    expect(result).toEqual({
      outcome: "updated",
      newCheckpoints: 3,
      notificationIds: [expect.any(String)],
    });
    const updated = await reload(stale.id);
    expect(updated.status).toBe("OutForDelivery");
    expect(updated.lastSyncedAt).toEqual(NOW);
  });

  it("updates every user's shipment on a shared tracker", async () => {
    const other = (await insertUser(ctx.db)).id;
    const a = await add("fake:FAKE-OFD-6", 30);
    const b = await add("fake:FAKE-OFD-6", 30, { userId: other });

    await refetch("fake:FAKE-OFD-6");

    expect(getTracking).toHaveBeenCalledOnce();
    expect((await reload(a.id)).status).toBe("OutForDelivery");
    expect((await reload(b.id)).status).toBe("OutForDelivery");
  });

  it("reports unchanged when nothing is new, but still counts it as synced", async () => {
    const row = await add("fake:FAKE-OFD-7", 30);
    await refetch("fake:FAKE-OFD-7");
    const later = new Date(NOW.getTime() + 2 * HOUR);

    expect(await refetch("fake:FAKE-OFD-7", later)).toEqual({
      outcome: "unchanged",
      newCheckpoints: 0,
      notificationIds: [],
    });
    expect((await reload(row.id)).lastSyncedAt).toEqual(later);
  });

  it("marks a permanently failing tracker synced, logging the error name only", async () => {
    const broken = await add("fake:FAKE-TRANSIT-BROKEN", 90);
    getTracking.mockRejectedValueOnce(
      new TrackerNotFoundError("secret-detail"),
    );

    expect(await refetch("fake:FAKE-TRANSIT-BROKEN")).toEqual({
      outcome: "failed",
    });
    expect((await reload(broken.id)).lastSyncedAt).toEqual(NOW);
    const logged = JSON.stringify(vi.mocked(console.warn).mock.calls);
    expect(logged).toContain("TrackerNotFoundError");
    expect(logged).not.toContain("secret-detail");
  });

  it("does not let one tracker's failure affect another", async () => {
    await add("fake:FAKE-TRANSIT-BAD", 90);
    const healthy = await add("fake:FAKE-OFD-8", 30);
    getTracking.mockRejectedValueOnce(new TrackerNotFoundError("gone"));

    await refetch("fake:FAKE-TRANSIT-BAD");
    const result = await refetch("fake:FAKE-OFD-8");

    expect(result.outcome).toBe("updated");
    expect((await reload(healthy.id)).status).toBe("OutForDelivery");
  });

  it.each([
    ["rate limiting", () => new RateLimitedError()],
    ["the provider being down", () => new ProviderUnavailableError()],
  ])(
    "throws on %s so the job retries, and leaves the tracker stale",
    async (_name, makeError) => {
      const row = await add("fake:FAKE-TRANSIT-R", 90);
      getTracking.mockRejectedValueOnce(makeError());

      await expect(refetch("fake:FAKE-TRANSIT-R")).rejects.toThrow();
      expect((await reload(row.id)).lastSyncedAt).toEqual(ago(90));
    },
  );

  it.each([
    ["a bad API key", () => new ProviderAuthError("401"), "auth"],
    ["an exhausted quota", () => new QuotaExceededError("quota"), "quota"],
  ] as const)(
    "on %s, stops the work for the hour, reports once and leaves trackers stale",
    async (_name, makeError, reason) => {
      const first = await add("fake:FAKE-TRANSIT-X", 90);
      const second = await add("fake:FAKE-TRANSIT-Y", 60);
      getTracking.mockRejectedValueOnce(makeError());

      expect(await refetch("fake:FAKE-TRANSIT-X")).toEqual({
        outcome: "stopped",
        reason,
        firstReport: true,
      });
      // Every other queued tracker this hour skips the provider.
      expect(await refetch("fake:FAKE-TRANSIT-Y")).toEqual({
        outcome: "paused",
      });
      expect(getTracking).toHaveBeenCalledOnce();
      expect((await reload(first.id)).lastSyncedAt).toEqual(ago(90));
      expect((await reload(second.id)).lastSyncedAt).toEqual(ago(60));
    },
  );

  it("a second run that meets the same problem in the same hour does not report again", async () => {
    await add("fake:FAKE-TRANSIT-Q1", 90);
    await add("fake:FAKE-TRANSIT-Q2", 90);
    getTracking.mockRejectedValue(new QuotaExceededError("quota"));

    // Two runs racing past the pause check before either tripped it.
    const [a, b] = await Promise.all([
      refetch("fake:FAKE-TRANSIT-Q1"),
      refetch("fake:FAKE-TRANSIT-Q2"),
    ]);
    const reports = [a, b].filter(
      (r) => r.outcome === "stopped" && r.firstReport,
    );
    expect(reports).toHaveLength(1);
  });

  it("lets an unexpected error escape so the job retries", async () => {
    await add("fake:FAKE-TRANSIT-Z", 30);
    getTracking.mockRejectedValueOnce(new Error("socket hang up"));
    await expect(refetch("fake:FAKE-TRANSIT-Z")).rejects.toThrow(
      "socket hang up",
    );
  });
});

describe("buildRefetchEvents", () => {
  it("makes one event per tracker, with an id per tracker per hour", () => {
    const bucket = Math.floor(NOW.getTime() / HOUR);
    expect(buildRefetchEvents(["fake:A"], NOW)).toEqual([
      {
        id: "refetch-fake:A-" + bucket,
        name: "wayfind/tracker.refetch",
        data: { trackerId: "fake:A" },
      },
    ]);
    expect(
      buildRefetchEvents(["fake:A"], new Date(NOW.getTime() + HOUR))[0]?.id,
    ).not.toBe("refetch-fake:A-" + bucket);
  });
});
