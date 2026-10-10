// @vitest-environment node
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createTestDb, insertUser } from "../../../tests/db/pglite";
import { adminCounts, trackersCreatedPerDay } from "./admin-stats";
import { inboundEmails, notifications, shipments } from "./schema";

const NOW = new Date("2026-10-09T12:00:00Z");
const DAY = 86_400_000;
const daysAgo = (n: number) => new Date(NOW.getTime() - n * DAY);

let ctx: Awaited<ReturnType<typeof createTestDb>>;
let a: string;
let b: string;

beforeAll(async () => {
  ctx = await createTestDb();
  a = (await insertUser(ctx.db)).id;
  b = (await insertUser(ctx.db)).id;

  let seq = 0;
  const ship = (
    userId: string,
    tracker: string | null,
    createdAt: Date,
    extra: Partial<typeof shipments.$inferInsert> = {},
  ) =>
    ctx.db.insert(shipments).values({
      userId,
      trackingNumber: "ADM-" + ++seq,
      provider: "ship24",
      providerTrackerId: tracker,
      createdAt,
      ...extra,
    });

  // Two trackers on day -1; one of them shared by both users (counts once,
  // on the day it was first used).
  await ship(a, "t-shared", daysAgo(1));
  await ship(b, "t-shared", daysAgo(0));
  await ship(a, "t-solo", daysAgo(1));
  await ship(b, "t-today", daysAgo(0), { status: "Delivered" });
  // Too old for the window, another provider, and no tracker at all.
  await ship(a, "t-old", daysAgo(40), { status: "InTransit" });
  await ship(a, "t-fake", daysAgo(1), { provider: "fake" });
  await ship(b, null, daysAgo(1), { archivedAt: daysAgo(0) });

  const [shipment] = await ctx.db.select().from(shipments).limit(1);
  await ctx.db.insert(inboundEmails).values([
    { userId: a, raw: "{}", parseStatus: "failed", receivedAt: daysAgo(2) },
    { userId: b, raw: "{}", parseStatus: "failed", receivedAt: daysAgo(10) },
    { userId: b, raw: "{}", parseStatus: "pending", receivedAt: daysAgo(3) },
    { userId: a, raw: "{}", parseStatus: "pending", receivedAt: daysAgo(1) },
  ]);
  await ctx.db.insert(notifications).values([
    {
      userId: a,
      shipmentId: shipment!.id,
      kind: "delivered",
      dedupeKey: "k1",
      status: "failed",
      createdAt: daysAgo(1),
    },
    {
      userId: a,
      shipmentId: shipment!.id,
      kind: "problem",
      dedupeKey: "k2",
      status: "pending",
      createdAt: daysAgo(4),
    },
  ]);
});

afterAll(async () => {
  await ctx.client.close();
});

describe("trackersCreatedPerDay", () => {
  it("counts each tracker once, on the day it was first used, across users", async () => {
    expect(await trackersCreatedPerDay(ctx.db, "ship24", daysAgo(30))).toEqual([
      { day: "2026-10-08", count: 2 },
      { day: "2026-10-09", count: 1 },
    ]);
  });

  it("is per provider", async () => {
    expect(await trackersCreatedPerDay(ctx.db, "fake", daysAgo(30))).toEqual([
      { day: "2026-10-08", count: 1 },
    ]);
  });
});

describe("adminCounts", () => {
  it("counts across every user, and failures in the window only", async () => {
    expect(await adminCounts(ctx.db, daysAgo(7))).toEqual({
      users: 2,
      // Not Delivered, not archived: shared x2, solo, old, fake.
      activeShipments: 5,
      failedEmails: 1,
      failedNotifications: 1,
      oldestPendingEmail: daysAgo(3),
      oldestPendingNotification: daysAgo(4),
    });
  });

  it("returns counts and times only, never shipment contents", async () => {
    const result = JSON.stringify([
      await adminCounts(ctx.db, daysAgo(7)),
      await trackersCreatedPerDay(ctx.db, "ship24", daysAgo(30)),
    ]);
    for (const text of ["ADM-", "t-shared", "t-solo", "@example.test"]) {
      expect(result).not.toContain(text);
    }
  });

  it("is empty for an empty database", async () => {
    const empty = await createTestDb();
    expect(await adminCounts(empty.db, daysAgo(7))).toEqual({
      users: 0,
      activeShipments: 0,
      failedEmails: 0,
      failedNotifications: 0,
      oldestPendingEmail: null,
      oldestPendingNotification: null,
    });
    await empty.client.close();
  });
});
