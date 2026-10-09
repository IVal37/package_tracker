// @vitest-environment node
import { eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  createTestDb,
  insertShipment,
  insertUser,
} from "../../../tests/db/pglite";
import { notifications, shipments } from "@/lib/db/schema";
import {
  KEEP_NOTIFICATIONS_DAYS,
  cleanupNotifications,
  sweepNotifications,
} from "./maintenance";

let ctx: Awaited<ReturnType<typeof createTestDb>>;

beforeAll(async () => {
  ctx = await createTestDb();
});

afterAll(async () => {
  await ctx.client.close();
});

const NOW = new Date("2026-06-20T12:00:00Z");
const MINUTE = 60_000;
const DAY = 24 * 60 * MINUTE;

let seq = 0;
async function record(createdAt: Date, status: "pending" | "sent" = "pending") {
  const user = await insertUser(ctx.db);
  const shipment = await insertShipment(ctx.db, user.id);
  const [row] = await ctx.db
    .insert(notifications)
    .values({
      userId: user.id,
      shipmentId: shipment.id,
      kind: "delivered",
      dedupeKey: `m-${++seq}`,
      createdAt,
      status,
    })
    .returning();
  return row!;
}

describe("sweepNotifications", () => {
  it("re-queues only pending alerts older than ten minutes, oldest first", async () => {
    const lost = await record(new Date(NOW.getTime() - 30 * MINUTE));
    const older = await record(new Date(NOW.getTime() - 120 * MINUTE));
    await record(new Date(NOW.getTime() - 3 * MINUTE)); // too new: its event is still on its way
    await record(new Date(NOW.getTime() - 60 * MINUTE), "sent"); // finished

    const { retry } = await sweepNotifications({
      db: ctx.db,
      now: NOW,
      limit: 100,
    });

    expect(retry.filter((id) => [lost.id, older.id].includes(id))).toEqual([
      older.id,
      lost.id,
    ]);
    expect(retry).toHaveLength(2);
  });

  it("records new overdue alerts and returns them separately", async () => {
    const user = await insertUser(ctx.db);
    const late = await insertShipment(ctx.db, user.id);
    await ctx.db
      .update(shipments)
      .set({ eta: new Date(NOW.getTime() - 2 * DAY), status: "InTransit" })
      .where(eq(shipments.id, late.id));

    const first = await sweepNotifications({
      db: ctx.db,
      now: NOW,
      limit: 100,
    });
    expect(first.fresh).toHaveLength(1);
    // Just recorded, so it is not "lost" yet.
    expect(first.retry).not.toContain(first.fresh[0]);

    const again = await sweepNotifications({
      db: ctx.db,
      now: NOW,
      limit: 100,
    });
    expect(again.fresh).toEqual([]);
  });

  it("passes the limit on", async () => {
    for (let i = 0; i < 3; i++) {
      await record(new Date(NOW.getTime() - (200 + i) * MINUTE));
    }
    const { retry } = await sweepNotifications({
      db: ctx.db,
      now: NOW,
      limit: 2,
    });
    expect(retry).toHaveLength(2);
  });
});

describe("cleanupNotifications", () => {
  it("deletes alerts older than 90 days, whatever their outcome, and keeps the rest", async () => {
    const old = await record(
      new Date(NOW.getTime() - (KEEP_NOTIFICATIONS_DAYS + 1) * DAY),
      "sent",
    );
    const oldPending = await record(new Date(NOW.getTime() - 200 * DAY));
    const recent = await record(
      new Date(NOW.getTime() - (KEEP_NOTIFICATIONS_DAYS - 1) * DAY),
    );

    const result = await cleanupNotifications({ db: ctx.db, now: NOW });

    expect(result.deleted).toBeGreaterThanOrEqual(2);
    const left = async (id: string) =>
      (
        await ctx.db
          .select()
          .from(notifications)
          .where(eq(notifications.id, id))
      ).length;
    expect(await left(old.id)).toBe(0);
    expect(await left(oldPending.id)).toBe(0);
    expect(await left(recent.id)).toBe(1);
  });

  it("keeps an alert exactly at the limit and deletes nothing when nothing is old", async () => {
    const edge = await record(
      new Date(NOW.getTime() - KEEP_NOTIFICATIONS_DAYS * DAY),
    );
    await cleanupNotifications({ db: ctx.db, now: NOW });
    expect(
      await ctx.db
        .select()
        .from(notifications)
        .where(eq(notifications.id, edge.id)),
    ).toHaveLength(1);

    const empty = await createTestDb();
    expect(await cleanupNotifications({ db: empty.db, now: NOW })).toEqual({
      deleted: 0,
    });
    await empty.client.close();
  });
});
