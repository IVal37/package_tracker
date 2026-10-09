// @vitest-environment node
import { eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createTestDb, insertUser } from "../../../tests/db/pglite";
import type {
  NormalizedEvent,
  NormalizedShipment,
  Status,
} from "@/lib/tracking";
import { checkpoints, shipments } from "./schema";
import {
  STALE_AFTER_MS,
  applyTrackerUpdate,
  archiveDeliveredBefore,
  findStaleTrackers,
  markTrackerSynced,
} from "./tracker-sync";

let ctx: Awaited<ReturnType<typeof createTestDb>>;

beforeAll(async () => {
  ctx = await createTestDb();
});

afterAll(async () => {
  await ctx.client.close();
});

const NOW = new Date("2026-06-20T12:00:00Z");
const DAY = 24 * 60 * 60 * 1000;
const ago = (ms: number) => new Date(NOW.getTime() - ms);

let seq = 0;
const unique = (prefix: string) => `${prefix}-${++seq}`;

async function addShipment(
  overrides: Partial<typeof shipments.$inferInsert> & { userId: string },
) {
  const [row] = await ctx.db
    .insert(shipments)
    .values({
      trackingNumber: unique("TN"),
      provider: "fake",
      providerTrackerId: unique("tracker"),
      ...overrides,
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

const eventsOf = (shipmentId: string) =>
  ctx.db
    .select()
    .from(checkpoints)
    .where(eq(checkpoints.shipmentId, shipmentId));

const event = (
  id: string,
  occurredAt: Date,
  status: Status,
): NormalizedEvent => ({
  providerEventId: id,
  occurredAt,
  status,
  message: null,
  locationText: null,
  courierCode: null,
  order: null,
});

const update = (
  trackerId: string,
  status: Status,
  events: NormalizedEvent[],
  destination: string | null = null,
): NormalizedShipment => ({
  providerTrackerId: trackerId,
  trackingNumber: "IGNORED",
  courier: null,
  status,
  eta: null,
  lastEventAt: events[0]?.occurredAt ?? null,
  destination,
  events,
});

describe("applyTrackerUpdate", () => {
  it("updates every shipment that shares the tracker, for every user", async () => {
    const a = await insertUser(ctx.db);
    const b = await insertUser(ctx.db);
    const trackerId = unique("shared");
    const forA = await addShipment({
      userId: a.id,
      providerTrackerId: trackerId,
    });
    const forB = await addShipment({
      userId: b.id,
      providerTrackerId: trackerId,
    });

    const result = await applyTrackerUpdate(
      ctx.db,
      "fake",
      update(trackerId, "OutForDelivery", [
        event("e1", ago(1000), "OutForDelivery"),
      ]),
      NOW,
    );

    expect(result).toEqual({
      shipments: 2,
      newCheckpoints: 2,
      notificationIds: [expect.any(String), expect.any(String)],
    });
    for (const row of [forA, forB]) {
      const reloaded = await reload(row.id);
      expect(reloaded.status).toBe("OutForDelivery");
      expect(reloaded.lastSyncedAt).toEqual(NOW);
      expect(await eventsOf(row.id)).toHaveLength(1);
    }
  });

  it("creates no duplicate checkpoints when the same payload arrives twice", async () => {
    const user = await insertUser(ctx.db);
    const row = await addShipment({ userId: user.id });
    const payload = update(row.providerTrackerId!, "InTransit", [
      event("dup-1", ago(5000), "InTransit"),
    ]);

    const first = await applyTrackerUpdate(ctx.db, "fake", payload, NOW);
    const second = await applyTrackerUpdate(ctx.db, "fake", payload, NOW);

    expect(first.newCheckpoints).toBe(1);
    expect(second).toEqual({
      shipments: 1,
      newCheckpoints: 0,
      notificationIds: [],
    });
    expect(await eventsOf(row.id)).toHaveLength(1);
  });

  it("stores a late older event but does not move the status back", async () => {
    const user = await insertUser(ctx.db);
    const row = await addShipment({ userId: user.id });
    const trackerId = row.providerTrackerId!;

    await applyTrackerUpdate(
      ctx.db,
      "fake",
      update(trackerId, "OutForDelivery", [
        event("new", ago(1000), "OutForDelivery"),
      ]),
      NOW,
    );
    await applyTrackerUpdate(
      ctx.db,
      "fake",
      update(trackerId, "InTransit", [event("old", ago(9000), "InTransit")]),
      NOW,
    );

    const reloaded = await reload(row.id);
    expect(reloaded.status).toBe("OutForDelivery");
    expect(reloaded.lastEventAt).toEqual(ago(1000));
    expect(await eventsOf(row.id)).toHaveLength(2);
  });

  it("stores the destination, and a later update without one keeps it", async () => {
    const user = await insertUser(ctx.db);
    const row = await addShipment({ userId: user.id });
    const trackerId = row.providerTrackerId!;

    await applyTrackerUpdate(
      ctx.db,
      "fake",
      update(trackerId, "InTransit", [], "SAN RAFAEL, CA, 94901, US"),
      NOW,
    );
    expect((await reload(row.id)).destinationText).toBe(
      "SAN RAFAEL, CA, 94901, US",
    );

    await applyTrackerUpdate(
      ctx.db,
      "fake",
      update(trackerId, "InTransit", [], null),
      NOW,
    );
    expect((await reload(row.id)).destinationText).toBe(
      "SAN RAFAEL, CA, 94901, US",
    );

    await applyTrackerUpdate(
      ctx.db,
      "fake",
      update(trackerId, "InTransit", [], "OAKLAND, CA, US"),
      NOW,
    );
    expect((await reload(row.id)).destinationText).toBe("OAKLAND, CA, US");
  });

  it("does nothing for an unknown tracker", async () => {
    const result = await applyTrackerUpdate(
      ctx.db,
      "fake",
      update("nobody-has-this", "InTransit", [
        event("x", ago(1000), "InTransit"),
      ]),
      NOW,
    );
    expect(result).toEqual({
      shipments: 0,
      newCheckpoints: 0,
      notificationIds: [],
    });
  });

  it("leaves another provider's shipment with the same tracker id alone", async () => {
    const user = await insertUser(ctx.db);
    const row = await addShipment({
      userId: user.id,
      provider: "ship24",
      providerTrackerId: "same-id",
    });

    const result = await applyTrackerUpdate(
      ctx.db,
      "fake",
      update("same-id", "Delivered", [event("x", ago(1000), "Delivered")]),
      NOW,
    );

    expect(result.shipments).toBe(0);
    expect((await reload(row.id)).status).toBe("Pending");
    expect(await eventsOf(row.id)).toHaveLength(0);
  });
});

describe("findStaleTrackers", () => {
  it("returns only stale, live, non-terminal shipments of the provider", async () => {
    const user = await insertUser(ctx.db);
    const stale = ago(STALE_AFTER_MS + 1000);
    const make = (extra: Partial<typeof shipments.$inferInsert>) =>
      addShipment({ userId: user.id, lastSyncedAt: stale, ...extra });

    const picked = await make({ status: "InTransit" });
    const pending = await make({ status: "Pending" });
    const skipped = [
      await make({ lastSyncedAt: ago(1000) }), // fresh
      await make({ archivedAt: ago(1000) }), // archived
      await make({ status: "Delivered" }),
      await make({ status: "Expired" }),
      await make({ provider: "ship24" }),
    ];

    const found = await findStaleTrackers(ctx.db, "fake", NOW, 1000);
    expect(found).toContain(picked.providerTrackerId);
    expect(found).toContain(pending.providerTrackerId);
    for (const row of skipped) {
      expect(found).not.toContain(row.providerTrackerId);
    }
  });

  it("ignores shipments that have no tracker id", async () => {
    const user = await insertUser(ctx.db);
    await addShipment({
      userId: user.id,
      providerTrackerId: null,
      lastSyncedAt: ago(STALE_AFTER_MS + 1000),
    });
    const found = await findStaleTrackers(ctx.db, "fake", NOW, 1000);
    expect(found).not.toContain(null);
  });

  it("treats exactly 24 hours as not yet stale", async () => {
    const user = await insertUser(ctx.db);
    const edge = await addShipment({
      userId: user.id,
      lastSyncedAt: ago(STALE_AFTER_MS),
    });
    const found = await findStaleTrackers(ctx.db, "fake", NOW, 100);
    expect(found).not.toContain(edge.providerTrackerId);
  });

  it("lists a shared tracker once, oldest sync first, and respects the limit", async () => {
    // Own database: the ordering and limit checks must see only these rows.
    const isolated = await createTestDb();
    try {
      const a = await insertUser(isolated.db);
      const b = await insertUser(isolated.db);
      const add = async (
        userId: string,
        trackerId: string,
        syncedAgo: number,
      ) => {
        await isolated.db.insert(shipments).values({
          userId,
          trackingNumber: unique("TN"),
          provider: "fake",
          providerTrackerId: trackerId,
          lastSyncedAt: ago(syncedAgo),
        });
      };
      await add(a.id, "newer", 3 * DAY);
      await add(a.id, "shared", 5 * DAY);
      await add(b.id, "shared", 2 * DAY);
      await add(b.id, "oldest", 9 * DAY);

      expect(await findStaleTrackers(isolated.db, "fake", NOW, 100)).toEqual([
        "oldest",
        "shared",
        "newer",
      ]);
      expect(await findStaleTrackers(isolated.db, "fake", NOW, 2)).toEqual([
        "oldest",
        "shared",
      ]);
    } finally {
      await isolated.client.close();
    }
  });
});

describe("markTrackerSynced", () => {
  it("bumps last_synced_at for that tracker only", async () => {
    const user = await insertUser(ctx.db);
    const stale = ago(3 * DAY);
    const target = await addShipment({ userId: user.id, lastSyncedAt: stale });
    const other = await addShipment({ userId: user.id, lastSyncedAt: stale });

    await markTrackerSynced(ctx.db, "fake", target.providerTrackerId!, NOW);

    expect((await reload(target.id)).lastSyncedAt).toEqual(NOW);
    expect((await reload(other.id)).lastSyncedAt).toEqual(stale);
  });
});

describe("archiveDeliveredBefore", () => {
  it("archives only Delivered shipments at or before the cutoff", async () => {
    const user = await insertUser(ctx.db);
    const cutoff = ago(14 * DAY);
    const make = (extra: Partial<typeof shipments.$inferInsert>) =>
      addShipment({ userId: user.id, ...extra });

    const old = await make({ status: "Delivered", lastEventAt: ago(20 * DAY) });
    const atCutoff = await make({ status: "Delivered", lastEventAt: cutoff });
    const recent = await make({
      status: "Delivered",
      lastEventAt: ago(13 * DAY),
    });
    const inTransit = await make({
      status: "InTransit",
      lastEventAt: ago(30 * DAY),
    });
    const noEvents = await make({ status: "Delivered", lastEventAt: null });
    const alreadyArchived = await make({
      status: "Delivered",
      lastEventAt: ago(30 * DAY),
      archivedAt: ago(10 * DAY),
    });

    const count = await archiveDeliveredBefore(ctx.db, cutoff, NOW);

    expect(count).toBe(2);
    expect((await reload(old.id)).archivedAt).toEqual(NOW);
    expect((await reload(atCutoff.id)).archivedAt).toEqual(NOW);
    expect((await reload(recent.id)).archivedAt).toBeNull();
    expect((await reload(inTransit.id)).archivedAt).toBeNull();
    expect((await reload(noEvents.id)).archivedAt).toBeNull();
    expect((await reload(alreadyArchived.id)).archivedAt).toEqual(
      ago(10 * DAY),
    );
  });

  it("is a no-op the second time", async () => {
    expect(await archiveDeliveredBefore(ctx.db, ago(14 * DAY), NOW)).toBe(0);
  });
});
