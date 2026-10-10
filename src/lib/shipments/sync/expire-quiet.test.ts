// @vitest-environment node
import { eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createTestDb, insertUser } from "../../../../tests/db/pglite";
import { applyTrackerUpdate, findStaleTrackers } from "@/lib/db/tracker-sync";
import { notifications, shipments } from "@/lib/db/schema";
import type { NormalizedShipment, Status } from "@/lib/tracking";
import { expireQuietShipments } from "./expire-quiet";

const NOW = new Date("2026-10-09T03:20:00Z");
const DAY = 86_400_000;
const daysAgo = (n: number) => new Date(NOW.getTime() - n * DAY);

let ctx: Awaited<ReturnType<typeof createTestDb>>;

beforeAll(async () => {
  ctx = await createTestDb();
});

afterAll(async () => {
  await ctx.client.close();
});

let seq = 0;
async function add(
  userId: string,
  extra: Partial<typeof shipments.$inferInsert>,
) {
  seq += 1;
  const [row] = await ctx.db
    .insert(shipments)
    .values({
      userId,
      trackingNumber: "EXP-" + seq,
      provider: "fake",
      providerTrackerId: "fake:EXP-" + seq,
      ...extra,
    })
    .returning();
  if (!row) throw new Error("insert failed");
  return row;
}

const statusOf = async (id: string) =>
  (await ctx.db.select().from(shipments).where(eq(shipments.id, id)))[0]
    ?.status;

const expire = (now = NOW, expireAfterDays = 60) =>
  expireQuietShipments({ db: ctx.db, now, expireAfterDays });

/** A provider update with one event at the given time. */
const update = (
  trackerId: string,
  status: Status,
  at: Date,
  eventId: string,
): NormalizedShipment => ({
  providerTrackerId: trackerId,
  trackingNumber: "EXP-REVIVE",
  courier: null,
  status,
  eta: null,
  lastEventAt: at,
  destination: null,
  events: [
    {
      providerEventId: eventId,
      occurredAt: at,
      status,
      message: null,
      locationText: null,
      courierCode: null,
      order: null,
    },
  ],
});

describe("expireQuietShipments", () => {
  it("expires a shipment only after N quiet days", async () => {
    const { id: userId } = await insertUser(ctx.db);
    const quiet = await add(userId, {
      status: "InTransit",
      lastEventAt: daysAgo(61),
    });
    const almost = await add(userId, {
      status: "InTransit",
      lastEventAt: new Date(daysAgo(60).getTime() + 1000),
    });
    const exception = await add(userId, {
      status: "Exception",
      lastEventAt: daysAgo(90),
    });

    const result = await expire();

    expect(result.expired).toBeGreaterThanOrEqual(2);
    expect(await statusOf(quiet.id)).toBe("Expired");
    expect(await statusOf(exception.id)).toBe("Expired");
    expect(await statusOf(almost.id)).toBe("InTransit");
  });

  it("never touches a Delivered shipment, however old", async () => {
    const { id: userId } = await insertUser(ctx.db);
    const delivered = await add(userId, {
      status: "Delivered",
      lastEventAt: daysAgo(400),
    });
    await expire();
    expect(await statusOf(delivered.id)).toBe("Delivered");
  });

  it("never touches an archived shipment", async () => {
    const { id: userId } = await insertUser(ctx.db);
    const archived = await add(userId, {
      status: "InTransit",
      lastEventAt: daysAgo(100),
      archivedAt: daysAgo(1),
    });
    await expire();
    expect(await statusOf(archived.id)).toBe("InTransit");
  });

  it("uses created_at when there are no events", async () => {
    const { id: userId } = await insertUser(ctx.db);
    const old = await add(userId, {
      status: "Pending",
      createdAt: daysAgo(61),
    });
    const fresh = await add(userId, {
      status: "Pending",
      createdAt: daysAgo(10),
    });
    await expire();
    expect(await statusOf(old.id)).toBe("Expired");
    expect(await statusOf(fresh.id)).toBe("Pending");
  });

  it("honours the configured number of days", async () => {
    const { id: userId } = await insertUser(ctx.db);
    const tenDays = await add(userId, {
      status: "InTransit",
      lastEventAt: daysAgo(10),
    });
    await expire(NOW, 60);
    expect(await statusOf(tenDays.id)).toBe("InTransit");
    await expire(NOW, 7);
    expect(await statusOf(tenDays.id)).toBe("Expired");
  });

  it("records no alert", async () => {
    const { id: userId } = await insertUser(ctx.db);
    const row = await add(userId, {
      status: "OutForDelivery",
      lastEventAt: daysAgo(70),
    });
    await expire();
    expect(
      await ctx.db
        .select()
        .from(notifications)
        .where(eq(notifications.shipmentId, row.id)),
    ).toHaveLength(0);
  });

  it("is excluded from the re-fetch once expired", async () => {
    const { id: userId } = await insertUser(ctx.db);
    const row = await add(userId, {
      status: "InTransit",
      lastEventAt: daysAgo(61),
      lastSyncedAt: daysAgo(3),
      providerTrackerId: "fake:EXP-REFETCH",
    });
    expect(await findStaleTrackers(ctx.db, "fake", NOW, 1000)).toContain(
      "fake:EXP-REFETCH",
    );
    await expire();
    expect(await statusOf(row.id)).toBe("Expired");
    expect(await findStaleTrackers(ctx.db, "fake", NOW, 1000)).not.toContain(
      "fake:EXP-REFETCH",
    );
  });

  it("is revived by a later event, by the normal event-time rule", async () => {
    const { id: userId } = await insertUser(ctx.db);
    const row = await add(userId, {
      status: "InTransit",
      lastEventAt: daysAgo(61),
      providerTrackerId: "fake:EXP-REVIVE",
    });
    await expire();
    expect(await statusOf(row.id)).toBe("Expired");

    // An old event arriving late changes nothing...
    await applyTrackerUpdate(
      ctx.db,
      "fake",
      update("fake:EXP-REVIVE", "InTransit", daysAgo(62), "old"),
      NOW,
    );
    expect(await statusOf(row.id)).toBe("Expired");

    // ...but a newer one moves it on.
    await applyTrackerUpdate(
      ctx.db,
      "fake",
      update("fake:EXP-REVIVE", "OutForDelivery", NOW, "new"),
      NOW,
    );
    expect(await statusOf(row.id)).toBe("OutForDelivery");
  });

  it("a second run expires nothing more", async () => {
    await expire();
    expect(await expire()).toEqual({ expired: 0 });
  });
});
