// @vitest-environment node
import { eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  createTestDb,
  insertShipment,
  insertUser,
} from "../../../tests/db/pglite";
import {
  notificationSettings,
  notifications,
  pushSubscriptions,
  shipments,
  users,
} from "./schema";

let ctx: Awaited<ReturnType<typeof createTestDb>>;

beforeAll(async () => {
  ctx = await createTestDb();
});

afterAll(async () => {
  await ctx.client.close();
});

describe("notifications", () => {
  const alert = (userId: string, shipmentId: string, dedupeKey = "k1") => ({
    userId,
    shipmentId,
    kind: "delivered" as const,
    dedupeKey,
  });

  it("starts pending with nothing sent", async () => {
    const user = await insertUser(ctx.db);
    const shipment = await insertShipment(ctx.db, user.id);
    const [row] = await ctx.db
      .insert(notifications)
      .values(alert(user.id, shipment.id))
      .returning();
    expect(row).toMatchObject({
      status: "pending",
      pushSent: false,
      emailSent: false,
      skipReason: null,
      sentAt: null,
    });
  });

  it("rejects a repeat of the same event, but allows another kind or another event", async () => {
    const user = await insertUser(ctx.db);
    const shipment = await insertShipment(ctx.db, user.id);
    await ctx.db.insert(notifications).values(alert(user.id, shipment.id));

    await expect(
      ctx.db.insert(notifications).values(alert(user.id, shipment.id)),
    ).rejects.toThrow();

    await ctx.db
      .insert(notifications)
      .values({ ...alert(user.id, shipment.id), kind: "problem" });
    await ctx.db
      .insert(notifications)
      .values(alert(user.id, shipment.id, "k2"));
  });

  it("lets two users each have the same kind and key for their own shipments", async () => {
    const a = await insertUser(ctx.db);
    const b = await insertUser(ctx.db);
    const shipmentA = await insertShipment(ctx.db, a.id);
    const shipmentB = await insertShipment(ctx.db, b.id);
    await ctx.db.insert(notifications).values(alert(a.id, shipmentA.id));
    await ctx.db.insert(notifications).values(alert(b.id, shipmentB.id));
  });

  it("is deleted with its shipment and with its user", async () => {
    const user = await insertUser(ctx.db);
    const first = await insertShipment(ctx.db, user.id);
    const second = await insertShipment(ctx.db, user.id);
    await ctx.db.insert(notifications).values(alert(user.id, first.id));
    await ctx.db.insert(notifications).values(alert(user.id, second.id));

    await ctx.db.delete(shipments).where(eq(shipments.id, first.id));
    expect(
      await ctx.db
        .select()
        .from(notifications)
        .where(eq(notifications.userId, user.id)),
    ).toHaveLength(1);

    await ctx.db.delete(users).where(eq(users.id, user.id));
    expect(
      await ctx.db
        .select()
        .from(notifications)
        .where(eq(notifications.userId, user.id)),
    ).toHaveLength(0);
  });

  it("rejects an unknown kind or status", async () => {
    const user = await insertUser(ctx.db);
    const shipment = await insertShipment(ctx.db, user.id);
    await expect(
      ctx.client.query(
        `insert into notifications (user_id, shipment_id, kind, dedupe_key)
         values ($1, $2, 'bogus', 'k')`,
        [user.id, shipment.id],
      ),
    ).rejects.toThrow();
    await expect(
      ctx.client.query(
        `insert into notifications (user_id, shipment_id, kind, dedupe_key, status)
         values ($1, $2, 'delivered', 'k', 'bogus')`,
        [user.id, shipment.id],
      ),
    ).rejects.toThrow();
  });

  it("has a partial index on pending rows", async () => {
    const result = await ctx.client.query<{ indexdef: string }>(
      `select indexdef from pg_indexes where indexname = 'notifications_pending_idx'`,
    );
    expect(result.rows[0]?.indexdef).toMatch(/WHERE .*pending/);
  });
});

describe("notification_settings", () => {
  it("defaults to push everywhere, email for delivered and problem, no quiet hours", async () => {
    const user = await insertUser(ctx.db);
    const [row] = await ctx.db
      .insert(notificationSettings)
      .values({ userId: user.id })
      .returning();
    expect(row).toMatchObject({
      pushOutForDelivery: true,
      pushDelivered: true,
      pushProblem: true,
      pushDelay: true,
      emailOutForDelivery: false,
      emailDelivered: true,
      emailProblem: true,
      emailDelay: false,
      quietEnabled: false,
      quietStart: 22 * 60,
      quietEnd: 7 * 60,
      timeZone: "UTC",
    });
  });

  it("holds one row per user", async () => {
    const user = await insertUser(ctx.db);
    await ctx.db.insert(notificationSettings).values({ userId: user.id });
    await expect(
      ctx.db.insert(notificationSettings).values({ userId: user.id }),
    ).rejects.toThrow();
  });

  it.each([
    ["start below 0", { quietStart: -1 }],
    ["start of 1440", { quietStart: 1440 }],
    ["end below 0", { quietEnd: -5 }],
    ["end of 1440", { quietEnd: 1440 }],
  ])("rejects quiet minutes outside a day: %s", async (_name, values) => {
    const user = await insertUser(ctx.db);
    await expect(
      ctx.db
        .insert(notificationSettings)
        .values({ userId: user.id, ...values }),
    ).rejects.toThrow();
  });

  it("accepts the edges of a day, and a window that wraps midnight", async () => {
    const user = await insertUser(ctx.db);
    await ctx.db
      .insert(notificationSettings)
      .values({ userId: user.id, quietStart: 1439, quietEnd: 0 });
  });
});

describe("push_subscriptions", () => {
  const subscription = (userId: string, endpoint = "https://push.test/a") => ({
    userId,
    endpoint,
    p256dh: "key",
    auth: "auth",
  });

  it("keeps an endpoint unique across users", async () => {
    const a = await insertUser(ctx.db);
    const b = await insertUser(ctx.db);
    await ctx.db
      .insert(pushSubscriptions)
      .values(subscription(a.id, "https://push.test/shared"));
    await expect(
      ctx.db
        .insert(pushSubscriptions)
        .values(subscription(b.id, "https://push.test/shared")),
    ).rejects.toThrow();
  });

  it("allows one user several devices, and is deleted with the user", async () => {
    const user = await insertUser(ctx.db);
    await ctx.db
      .insert(pushSubscriptions)
      .values([
        subscription(user.id, "https://push.test/phone"),
        subscription(user.id, "https://push.test/laptop"),
      ]);
    await ctx.db.delete(users).where(eq(users.id, user.id));
    expect(
      await ctx.db
        .select()
        .from(pushSubscriptions)
        .where(eq(pushSubscriptions.userId, user.id)),
    ).toHaveLength(0);
  });
});
