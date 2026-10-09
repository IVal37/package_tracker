// @vitest-environment node
import { eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  createTestDb,
  insertShipment,
  insertUser,
} from "../../../tests/db/pglite";
import {
  deleteNotificationsBefore,
  finishNotification,
  findPendingNotificationIds,
  hasNewerNotification,
  loadNotification,
} from "./notify-sync";
import { notifications } from "./schema";

let ctx: Awaited<ReturnType<typeof createTestDb>>;

beforeAll(async () => {
  ctx = await createTestDb();
});

afterAll(async () => {
  await ctx.client.close();
});

const NOW = new Date("2026-06-20T12:00:00Z");
const NO_SUCH_ID = "99999999-9999-4999-8999-999999999999";
const minutesAgo = (minutes: number) =>
  new Date(NOW.getTime() - minutes * 60_000);

let seq = 0;
async function record(
  overrides: Partial<typeof notifications.$inferInsert> = {},
  shipmentId?: string,
  userId?: string,
) {
  const owner = userId ? { id: userId } : await insertUser(ctx.db);
  const shipment = shipmentId
    ? { id: shipmentId }
    : await insertShipment(ctx.db, owner.id);
  const [row] = await ctx.db
    .insert(notifications)
    .values({
      userId: owner.id,
      shipmentId: shipment.id,
      kind: "delivered",
      dedupeKey: `n-${++seq}`,
      ...overrides,
    })
    .returning();
  return row!;
}

describe("loadNotification", () => {
  it("returns who the alert is for and about, and its state", async () => {
    const row = await record();
    expect(await loadNotification(ctx.db, row.id)).toEqual({
      id: row.id,
      userId: row.userId,
      shipmentId: row.shipmentId,
      kind: "delivered",
      status: "pending",
      createdAt: row.createdAt,
    });
  });

  it("returns null for an unknown or malformed id", async () => {
    expect(await loadNotification(ctx.db, NO_SUCH_ID)).toBeNull();
    expect(await loadNotification(ctx.db, "not-a-uuid")).toBeNull();
    expect(await loadNotification(ctx.db, "")).toBeNull();
  });
});

describe("hasNewerNotification", () => {
  it("is true only for a later alert on the same shipment", async () => {
    const first = await record({ createdAt: minutesAgo(30) });
    await record({ createdAt: minutesAgo(5) }, first.shipmentId, first.userId);
    const lonely = await record({ createdAt: minutesAgo(5) });

    expect(await hasNewerNotification(ctx.db, first)).toBe(true);
    expect(await hasNewerNotification(ctx.db, lonely)).toBe(false);
  });

  it("ignores alerts created at the same moment, and earlier ones", async () => {
    const mid = await record({ createdAt: minutesAgo(20) });
    await record({ createdAt: minutesAgo(20) }, mid.shipmentId, mid.userId);
    await record({ createdAt: minutesAgo(60) }, mid.shipmentId, mid.userId);
    expect(await hasNewerNotification(ctx.db, mid)).toBe(false);
  });

  it("does not look at other shipments, even of the same user", async () => {
    const mine = await record({ createdAt: minutesAgo(30) });
    const other = await insertShipment(ctx.db, mine.userId);
    await record({ createdAt: minutesAgo(1) }, other.id, mine.userId);
    expect(await hasNewerNotification(ctx.db, mine)).toBe(false);
  });
});

describe("finishNotification", () => {
  it("records the outcome of a pending alert", async () => {
    const row = await record();
    const done = await finishNotification(
      ctx.db,
      row.id,
      { status: "sent", pushSent: true, emailSent: false },
      NOW,
    );
    expect(done).toBe(true);
    const [saved] = await ctx.db
      .select()
      .from(notifications)
      .where(eq(notifications.id, row.id));
    expect(saved).toMatchObject({
      status: "sent",
      pushSent: true,
      emailSent: false,
      skipReason: null,
      sentAt: NOW,
    });
  });

  it("records a skip reason and no send time", async () => {
    const row = await record();
    await finishNotification(
      ctx.db,
      row.id,
      {
        status: "skipped",
        skipReason: "stale",
        pushSent: false,
        emailSent: false,
      },
      NOW,
    );
    const [saved] = await ctx.db
      .select()
      .from(notifications)
      .where(eq(notifications.id, row.id));
    expect(saved).toMatchObject({
      status: "skipped",
      skipReason: "stale",
      sentAt: null,
    });
  });

  it("refuses to overwrite an alert that is already finished", async () => {
    const row = await record();
    await finishNotification(
      ctx.db,
      row.id,
      { status: "sent", pushSent: true, emailSent: true },
      NOW,
    );
    const second = await finishNotification(
      ctx.db,
      row.id,
      { status: "failed", pushSent: false, emailSent: false },
      NOW,
    );
    expect(second).toBe(false);
    const [saved] = await ctx.db
      .select()
      .from(notifications)
      .where(eq(notifications.id, row.id));
    expect(saved?.status).toBe("sent");
  });

  it("returns false for an unknown or malformed id", async () => {
    const outcome = {
      status: "sent" as const,
      pushSent: true,
      emailSent: false,
    };
    expect(await finishNotification(ctx.db, NO_SUCH_ID, outcome, NOW)).toBe(
      false,
    );
    expect(await finishNotification(ctx.db, "nope", outcome, NOW)).toBe(false);
  });
});

describe("findPendingNotificationIds / deleteNotificationsBefore", () => {
  it("finds pending alerts older than the cutoff, oldest first, up to the limit", async () => {
    const empty = await createTestDb();
    const owner = await insertUser(empty.db);
    const shipment = await insertShipment(empty.db, owner.id);
    const add = async (createdAt: Date, status: "pending" | "sent") => {
      const [row] = await empty.db
        .insert(notifications)
        .values({
          userId: owner.id,
          shipmentId: shipment.id,
          kind: "delivered",
          dedupeKey: `f-${++seq}`,
          createdAt,
          status,
        })
        .returning();
      return row!.id;
    };
    const oldest = await add(minutesAgo(90), "pending");
    const old = await add(minutesAgo(40), "pending");
    await add(minutesAgo(40), "sent");
    await add(minutesAgo(2), "pending");

    expect(
      await findPendingNotificationIds(empty.db, minutesAgo(10), 10),
    ).toEqual([oldest, old]);
    expect(
      await findPendingNotificationIds(empty.db, minutesAgo(10), 1),
    ).toEqual([oldest]);
    expect(
      await findPendingNotificationIds(empty.db, minutesAgo(200), 10),
    ).toEqual([]);
    await empty.client.close();
  });

  it("deletes alerts created before the cutoff and reports how many", async () => {
    const empty = await createTestDb();
    const owner = await insertUser(empty.db);
    const shipment = await insertShipment(empty.db, owner.id);
    for (const [index, minutes] of [100, 50, 5].entries()) {
      await empty.db.insert(notifications).values({
        userId: owner.id,
        shipmentId: shipment.id,
        kind: "delivered",
        dedupeKey: `d-${index}`,
        createdAt: minutesAgo(minutes),
      });
    }
    expect(await deleteNotificationsBefore(empty.db, minutesAgo(20))).toBe(2);
    expect(await empty.db.select().from(notifications)).toHaveLength(1);
    expect(await deleteNotificationsBefore(empty.db, minutesAgo(20))).toBe(0);
    await empty.client.close();
  });
});
