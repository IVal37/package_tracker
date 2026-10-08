// @vitest-environment node
import { eq } from "drizzle-orm";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import {
  createTestDb,
  insertShipment,
  insertUser,
} from "../../../tests/db/pglite";
import { inboundEmails, orders } from "@/lib/db/schema";
import {
  PENDING_GRACE_MINUTES,
  RAW_EMAIL_DAYS,
  STALE_ORDER_DAYS,
  cleanupInboundData,
  findStuckEmailIds,
} from "./cleanup";

const NOW = new Date("2026-06-20T12:00:00Z");
const DAY = 24 * 60 * 60 * 1000;
const MINUTE = 60 * 1000;
const daysAgo = (days: number) => new Date(NOW.getTime() - days * DAY);
const minutesAgo = (minutes: number) =>
  new Date(NOW.getTime() - minutes * MINUTE);

let ctx: Awaited<ReturnType<typeof createTestDb>>;
let userId: string;

beforeAll(async () => {
  ctx = await createTestDb();
});

afterAll(async () => {
  await ctx.client.close();
});

beforeEach(async () => {
  await ctx.db.delete(orders);
  await ctx.db.delete(inboundEmails);
  userId = (await insertUser(ctx.db)).id;
});

async function addEmail(
  receivedAt: Date,
  parseStatus: "pending" | "parsed" | "failed" | "ignored" = "parsed",
  forUser = userId,
) {
  const [row] = await ctx.db
    .insert(inboundEmails)
    .values({ userId: forUser, raw: "{}", receivedAt, parseStatus })
    .returning();
  return row!.id;
}

async function addOrder(createdAt: Date, shipped: boolean, forUser = userId) {
  const shipmentId = shipped
    ? (await insertShipment(ctx.db, forUser)).id
    : null;
  const [row] = await ctx.db
    .insert(orders)
    .values({ userId: forUser, retailer: "Shop", createdAt, shipmentId })
    .returning();
  return row!.id;
}

const emailIds = async () =>
  (await ctx.db.select().from(inboundEmails)).map((e) => e.id);
const orderIds = async () =>
  (await ctx.db.select().from(orders)).map((o) => o.id);

describe("cleanupInboundData: raw emails", () => {
  it("uses a 30 day window", () => {
    expect(RAW_EMAIL_DAYS).toBe(30);
  });

  it("deletes emails older than 30 days, whatever their status", async () => {
    const old = [
      await addEmail(daysAgo(31), "parsed"),
      await addEmail(daysAgo(45), "failed"),
      await addEmail(daysAgo(90), "ignored"),
      await addEmail(daysAgo(60), "pending"),
    ];
    const keep = [
      await addEmail(daysAgo(29), "parsed"),
      await addEmail(daysAgo(1), "pending"),
      await addEmail(NOW, "parsed"),
    ];

    const result = await cleanupInboundData({ db: ctx.db, now: NOW });

    expect(result.emails).toBe(4);
    const left = await emailIds();
    for (const id of old) expect(left).not.toContain(id);
    expect(left.sort()).toEqual([...keep].sort());
  });

  it("keeps an email that is exactly 30 days old and deletes one a second older", async () => {
    const exactly = await addEmail(daysAgo(30));
    const older = await addEmail(new Date(daysAgo(30).getTime() - 1000));

    await cleanupInboundData({ db: ctx.db, now: NOW });

    const left = await emailIds();
    expect(left).toContain(exactly);
    expect(left).not.toContain(older);
  });

  it("covers every user", async () => {
    const other = (await insertUser(ctx.db)).id;
    await addEmail(daysAgo(40), "parsed", userId);
    await addEmail(daysAgo(40), "parsed", other);
    expect((await cleanupInboundData({ db: ctx.db, now: NOW })).emails).toBe(2);
  });

  it("is a no-op the second time", async () => {
    await addEmail(daysAgo(40));
    await cleanupInboundData({ db: ctx.db, now: NOW });
    expect(await cleanupInboundData({ db: ctx.db, now: NOW })).toEqual({
      emails: 0,
      orders: 0,
    });
  });

  it("keeps the order that came from a deleted email, just without the link", async () => {
    const emailId = await addEmail(daysAgo(40));
    const [order] = await ctx.db
      .insert(orders)
      .values({
        userId,
        retailer: "Shop",
        sourceEmailId: emailId,
        createdAt: daysAgo(40),
      })
      .returning();

    await cleanupInboundData({ db: ctx.db, now: NOW });

    const [kept] = await ctx.db
      .select()
      .from(orders)
      .where(eq(orders.id, order!.id));
    expect(kept?.sourceEmailId).toBeNull();
  });
});

describe("cleanupInboundData: unshipped orders", () => {
  it("uses a 90 day window", () => {
    expect(STALE_ORDER_DAYS).toBe(90);
  });

  it("deletes only placeholders older than 90 days", async () => {
    const stale = await addOrder(daysAgo(91), false);
    const fresh = await addOrder(daysAgo(89), false);
    const oldButShipped = await addOrder(daysAgo(200), true);

    const result = await cleanupInboundData({ db: ctx.db, now: NOW });

    expect(result.orders).toBe(1);
    const left = await orderIds();
    expect(left).not.toContain(stale);
    expect(left.sort()).toEqual([fresh, oldButShipped].sort());
  });

  it("never touches a shipped order, however old", async () => {
    const id = await addOrder(daysAgo(1000), true);
    await cleanupInboundData({ db: ctx.db, now: NOW });
    expect(await orderIds()).toEqual([id]);
  });
});

describe("findStuckEmailIds", () => {
  it("uses a 5 minute grace period", () => {
    expect(PENDING_GRACE_MINUTES).toBe(5);
  });

  it("returns only pending emails older than the grace period, oldest first", async () => {
    const older = await addEmail(minutesAgo(120), "pending");
    const old = await addEmail(minutesAgo(10), "pending");
    await addEmail(minutesAgo(2), "pending"); // still being processed
    await addEmail(minutesAgo(500), "parsed");
    await addEmail(minutesAgo(500), "failed");
    await addEmail(minutesAgo(500), "ignored");

    expect(
      await findStuckEmailIds({ db: ctx.db, now: NOW, limit: 10 }),
    ).toEqual([older, old]);
  });

  it("treats exactly five minutes as not yet stuck", async () => {
    await addEmail(minutesAgo(5), "pending");
    expect(
      await findStuckEmailIds({ db: ctx.db, now: NOW, limit: 10 }),
    ).toEqual([]);
  });

  it("respects the limit", async () => {
    for (let i = 0; i < 5; i++) await addEmail(minutesAgo(30 + i), "pending");
    expect(
      await findStuckEmailIds({ db: ctx.db, now: NOW, limit: 3 }),
    ).toHaveLength(3);
  });

  it("returns ids only, never email content", async () => {
    await addEmail(minutesAgo(30), "pending");
    const ids = await findStuckEmailIds({ db: ctx.db, now: NOW, limit: 10 });
    expect(ids.every((id) => typeof id === "string")).toBe(true);
  });
});
