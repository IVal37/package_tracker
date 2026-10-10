// @vitest-environment node
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createTestDb, insertUser } from "../../../tests/db/pglite";
import { seedFullUser } from "../../../tests/db/seed-user";
import { buildUserExport } from "./export";

const NOW = new Date("2026-10-09T12:00:00Z");

let ctx: Awaited<ReturnType<typeof createTestDb>>;
let alice: Awaited<ReturnType<typeof seedFullUser>>;

beforeAll(async () => {
  ctx = await createTestDb();
  alice = await seedFullUser(ctx.db, "alice");
  await seedFullUser(ctx.db, "bob");
});

afterAll(async () => {
  await ctx.client.close();
});

const exportFor = (userId: string) =>
  buildUserExport({
    db: ctx.db,
    userId,
    inboundDomain: "in.example.test",
    now: NOW,
  });

describe("buildUserExport", () => {
  it("holds the user's account", async () => {
    const data = await exportFor(alice.userId);
    expect(data.format).toBe("wayfind-export-1");
    expect(data.exportedAt).toBe(NOW.toISOString());
    expect(data.account).toEqual({
      email: "alice@example.test",
      forwardingAddress: "alice-alias@in.example.test",
      createdAt: expect.any(String),
    });
  });

  it("holds every row of the user's, one table at a time", async () => {
    const data = await exportFor(alice.userId);

    expect(data.packages).toEqual([
      expect.objectContaining({
        id: alice.shipmentId,
        trackingNumber: "ALICETRACK1",
        nickname: "alice boots",
        destination: "alice town",
        events: [
          {
            occurredAt: "2026-10-01T10:00:00.000Z",
            status: "InTransit",
            message: "alice departed",
            location: "alice hub",
          },
        ],
      }),
    ]);
    expect(data.orders).toEqual([
      expect.objectContaining({
        retailer: "alice shop",
        item: "alice item",
        orderNumber: "alice-1001",
        packageId: alice.shipmentId,
      }),
    ]);
    expect(data.forwardedEmails).toEqual([
      expect.objectContaining({
        from: "shop-alice@example.test",
        subject: "alice shipped",
        status: "parsed",
        whatWeRead: { retailer: "alice shop" },
        email: { subject: "alice shipped", text: "alice body" },
      }),
    ]);
    expect(data.notificationSettings?.quietHours.timeZone).toBe("Europe/Paris");
    expect(data.alerts).toEqual([
      expect.objectContaining({
        packageId: alice.shipmentId,
        kind: "delivered",
        status: "sent",
      }),
    ]);
    expect(data.pushDevices).toEqual({
      count: 1,
      devices: [{ addedAt: expect.any(String), lastReachedAt: null }],
    });
  });

  it("contains nothing of another user's", async () => {
    const text = JSON.stringify(await exportFor(alice.userId));
    expect(text.toLowerCase()).not.toContain("bob");
  });

  it("never includes a device's endpoint or keys", async () => {
    const text = JSON.stringify(await exportFor(alice.userId));
    expect(text).not.toContain("fcm.googleapis.com");
    expect(text).not.toContain("p256dh");
    expect(text).not.toContain("alice-auth");
  });

  it("is empty but well formed for a user with nothing", async () => {
    const user = await insertUser(ctx.db);
    const data = await exportFor(user.id);
    expect(data).toMatchObject({
      packages: [],
      orders: [],
      forwardedEmails: [],
      notificationSettings: null,
      alerts: [],
      pushDevices: { count: 0, devices: [] },
    });
    expect(data.account?.forwardingAddress).toBeNull();
  });

  it("is null-accounted for a user who does not exist", async () => {
    const data = await exportFor("99999999-9999-4999-8999-999999999999");
    expect(data.account).toBeNull();
    expect(data.packages).toEqual([]);
  });
});
