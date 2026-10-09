// @vitest-environment node
import { eq } from "drizzle-orm";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createTestDb, insertUser } from "../../../../tests/db/pglite";
import notifyDelivered from "../../../../tests/fixtures/fake/webhook-notify-delivered.json";
import notifyOfd from "../../../../tests/fixtures/fake/webhook-notify-ofd.json";
import legacyOfd from "../../../../tests/fixtures/fake/webhook-ofd.json";
import { notifications, shipments } from "@/lib/db/schema";
import { createTrackingProvider } from "@/lib/tracking";
import { handleTrackingWebhook } from "./handle-webhook";

// The webhook fixtures used in docs/notifications-setup.md, run through the
// real handler: the walkthrough claims exactly what these tests check.

const SECRET = "test-webhook-secret";
const NOW = new Date("2026-06-20T12:00:00Z");
const HOUR = 3_600_000;
const provider = createTrackingProvider({
  TRACKING_PROVIDER: "fake",
  SHIP24_API_KEY: "unused",
  SHIP24_WEBHOOK_SECRET: SECRET,
  FAKE_WEBHOOK_SECRET: SECRET,
});

let ctx: Awaited<ReturnType<typeof createTestDb>>;

// The fixtures all name the same tracker, so every test starts from an empty
// database: a webhook updates every package that follows its tracker.
beforeEach(async () => {
  ctx = await createTestDb();
});

afterEach(async () => {
  await ctx.client.close();
});

/** A FAKE-TRANSIT-1 package as the app creates it: in transit, due in 48 hours. */
async function addTransitPackage() {
  const user = await insertUser(ctx.db);
  const [row] = await ctx.db
    .insert(shipments)
    .values({
      userId: user.id,
      trackingNumber: "FAKE-TRANSIT-1",
      provider: "fake",
      providerTrackerId: "fake:FAKE-TRANSIT-1",
      status: "InTransit",
      eta: new Date(NOW.getTime() + 48 * HOUR),
    })
    .returning();
  return row!;
}

const send = (fixture: unknown) =>
  handleTrackingWebhook({
    db: ctx.db,
    provider,
    rawBody: JSON.stringify(fixture),
    headers: new Headers({ authorization: `Bearer ${SECRET}` }),
    now: NOW,
  });

const kindsOf = async (shipmentId: string) =>
  (
    await ctx.db
      .select()
      .from(notifications)
      .where(eq(notifications.shipmentId, shipmentId))
  )
    .map((row) => row.kind)
    .sort();

describe("the notification walkthrough fixtures", () => {
  it("out for delivery gives exactly one alert", async () => {
    const row = await addTransitPackage();

    const outcome = await send(notifyOfd);

    expect(outcome.notificationIds).toHaveLength(1);
    expect(await kindsOf(row.id)).toEqual(["out_for_delivery"]);
  });

  it("then delivered gives a second alert, and sending either again adds nothing", async () => {
    const row = await addTransitPackage();

    await send(notifyOfd);
    const delivered = await send(notifyDelivered);
    const again = await send(notifyDelivered);
    const againOfd = await send(notifyOfd);

    expect(delivered.notificationIds).toHaveLength(1);
    expect(again.notificationIds).toEqual([]);
    expect(againOfd.notificationIds).toEqual([]);
    expect(await kindsOf(row.id)).toEqual(["delivered", "out_for_delivery"]);
  });

  it("the older fixture also moves the ETA, so it gives a delay alert too", async () => {
    const row = await addTransitPackage();

    const outcome = await send(legacyOfd);

    expect(outcome.notificationIds).toHaveLength(2);
    expect(await kindsOf(row.id)).toEqual(["delay", "out_for_delivery"]);
  });

  it("alerts are recorded for the package's owner only", async () => {
    const mine = await addTransitPackage();
    const theirs = await addTransitPackage();
    // Two users following the same tracker each get their own alert.
    await send(notifyOfd);

    const rows = await ctx.db.select().from(notifications);
    const owners = new Map(rows.map((r) => [r.shipmentId, r.userId]));
    expect(owners.get(mine.id)).toBe(mine.userId);
    expect(owners.get(theirs.id)).toBe(theirs.userId);
  });
});
