// @vitest-environment node
import { eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createTestDb, insertUser } from "../../../tests/db/pglite";
import type { Status } from "@/lib/tracking";
import { insertOverdueAlerts } from "./notify-sync";
import { notifications, shipments } from "./schema";

let ctx: Awaited<ReturnType<typeof createTestDb>>;

beforeAll(async () => {
  ctx = await createTestDb();
});

afterAll(async () => {
  await ctx.client.close();
});

const NOW = new Date("2026-06-20T12:00:00Z");
const DAY = 24 * 60 * 60 * 1000;
const daysAgo = (days: number) => new Date(NOW.getTime() - days * DAY);

let seq = 0;
async function addShipment(
  userId: string,
  overrides: Partial<typeof shipments.$inferInsert> = {},
) {
  const [row] = await ctx.db
    .insert(shipments)
    .values({
      userId,
      trackingNumber: `OVERDUE-${++seq}`,
      provider: "fake",
      status: "InTransit",
      ...overrides,
    })
    .returning();
  if (!row) throw new Error("insert failed");
  return row;
}

const alertsOf = (shipmentId: string) =>
  ctx.db
    .select()
    .from(notifications)
    .where(eq(notifications.shipmentId, shipmentId));

describe("insertOverdueAlerts", () => {
  it("records a delay alert for a shipment whose ETA passed more than a day ago", async () => {
    const user = await insertUser(ctx.db);
    const late = await addShipment(user.id, { eta: daysAgo(2) });

    const ids = await insertOverdueAlerts(ctx.db, NOW, 100);

    const rows = await alertsOf(late.id);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      userId: user.id,
      kind: "delay",
      status: "pending",
      dedupeKey: `overdue:${daysAgo(2).toISOString().slice(0, 10)}`,
    });
    expect(ids).toContain(rows[0]!.id);
  });

  it("skips an ETA that is only a few hours past, in the future, or missing", async () => {
    const user = await insertUser(ctx.db);
    const recent = await addShipment(user.id, {
      eta: new Date(NOW.getTime() - 6 * 3_600_000),
    });
    const future = await addShipment(user.id, {
      eta: new Date(NOW.getTime() + DAY),
    });
    const none = await addShipment(user.id, { eta: null });

    await insertOverdueAlerts(ctx.db, NOW, 100);

    for (const row of [recent, future, none]) {
      expect(await alertsOf(row.id)).toHaveLength(0);
    }
  });

  it("skips an ETA older than 14 days", async () => {
    const user = await insertUser(ctx.db);
    const ancient = await addShipment(user.id, { eta: daysAgo(15) });
    const edge = await addShipment(user.id, { eta: daysAgo(13) });

    await insertOverdueAlerts(ctx.db, NOW, 100);

    expect(await alertsOf(ancient.id)).toHaveLength(0);
    expect(await alertsOf(edge.id)).toHaveLength(1);
  });

  it.each<[string, Partial<typeof shipments.$inferInsert>]>([
    ["delivered", { status: "Delivered" }],
    ["expired", { status: "Expired" }],
    ["waiting at a pickup point", { status: "AvailableForPickup" }],
    ["archived", { archivedAt: daysAgo(1) }],
  ])("skips a shipment that is %s", async (_name, overrides) => {
    const user = await insertUser(ctx.db);
    const row = await addShipment(user.id, { eta: daysAgo(3), ...overrides });

    await insertOverdueAlerts(ctx.db, NOW, 100);

    expect(await alertsOf(row.id)).toHaveLength(0);
  });

  it.each<Status>([
    "Pending",
    "InTransit",
    "OutForDelivery",
    "Exception",
    "AttemptFail",
  ])("alerts for an overdue %s shipment", async (status) => {
    const user = await insertUser(ctx.db);
    const row = await addShipment(user.id, { eta: daysAgo(3), status });
    await insertOverdueAlerts(ctx.db, NOW, 100);
    expect(await alertsOf(row.id)).toHaveLength(1);
  });

  it("records nothing the second time, and returns no ids", async () => {
    const user = await insertUser(ctx.db);
    const row = await addShipment(user.id, { eta: daysAgo(2) });

    await insertOverdueAlerts(ctx.db, NOW, 100);
    const again = await insertOverdueAlerts(ctx.db, NOW, 100);
    const later = await insertOverdueAlerts(
      ctx.db,
      new Date(NOW.getTime() + 3 * 3_600_000),
      100,
    );

    expect(again).not.toContain((await alertsOf(row.id))[0]!.id);
    expect(later).not.toContain((await alertsOf(row.id))[0]!.id);
    expect(await alertsOf(row.id)).toHaveLength(1);
  });

  it("alerts again for a new promised day, but not for the same one", async () => {
    const user = await insertUser(ctx.db);
    const row = await addShipment(user.id, { eta: daysAgo(6) });
    await insertOverdueAlerts(ctx.db, NOW, 100);

    // The carrier promises a new day, which then also passes.
    await ctx.db
      .update(shipments)
      .set({ eta: daysAgo(2) })
      .where(eq(shipments.id, row.id));
    await insertOverdueAlerts(ctx.db, NOW, 100);

    expect((await alertsOf(row.id)).map((r) => r.dedupeKey).sort()).toEqual([
      `overdue:${daysAgo(6).toISOString().slice(0, 10)}`,
      `overdue:${daysAgo(2).toISOString().slice(0, 10)}`,
    ]);
  });

  it("gives every user their own alert", async () => {
    const a = await insertUser(ctx.db);
    const b = await insertUser(ctx.db);
    const forA = await addShipment(a.id, { eta: daysAgo(2) });
    const forB = await addShipment(b.id, { eta: daysAgo(2) });

    await insertOverdueAlerts(ctx.db, NOW, 100);

    expect((await alertsOf(forA.id))[0]?.userId).toBe(a.id);
    expect((await alertsOf(forB.id))[0]?.userId).toBe(b.id);
  });

  it("respects the limit, oldest ETA first, and the rest follow on the next run", async () => {
    const user = await insertUser(ctx.db);
    const oldest = await addShipment(user.id, { eta: daysAgo(10) });
    const middle = await addShipment(user.id, { eta: daysAgo(8) });
    const newest = await addShipment(user.id, { eta: daysAgo(4) });

    const first = await insertOverdueAlerts(ctx.db, NOW, 2);
    expect(first.length).toBeGreaterThanOrEqual(2);
    expect(await alertsOf(oldest.id)).toHaveLength(1);
    expect(await alertsOf(middle.id)).toHaveLength(1);

    await insertOverdueAlerts(ctx.db, NOW, 2);
    expect(await alertsOf(newest.id)).toHaveLength(1);
  });

  it("does not let already-alerted shipments crowd out new ones", async () => {
    const user = await insertUser(ctx.db);
    const done = await addShipment(user.id, { eta: daysAgo(12) });
    await insertOverdueAlerts(ctx.db, NOW, 100);
    expect(await alertsOf(done.id)).toHaveLength(1);

    const fresh = await addShipment(user.id, { eta: daysAgo(3) });
    // A limit of 1 would be spent on `done` again if it were not excluded.
    const ids = await insertOverdueAlerts(ctx.db, NOW, 1);

    expect(await alertsOf(fresh.id)).toHaveLength(1);
    expect(ids).toEqual([(await alertsOf(fresh.id))[0]!.id]);
  });

  it("returns an empty list when nothing is overdue", async () => {
    const empty = await createTestDb();
    expect(await insertOverdueAlerts(empty.db, NOW, 100)).toEqual([]);
    await empty.client.close();
  });
});
