// @vitest-environment node
import { eq } from "drizzle-orm";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { reportIssue } = vi.hoisted(() => ({ reportIssue: vi.fn() }));
vi.mock("@/lib/monitoring", () => ({ reportIssue }));

import * as schema from "@/lib/db/schema";
import { createTrackingProvider } from "@/lib/tracking";
import { createTestDb } from "../../../tests/db/pglite";
import { seedFullUser } from "../../../tests/db/seed-user";
import { deleteAccount } from "./delete-account";

const NOW = new Date("2026-10-09T12:00:00Z");

/** Every table that holds user data, with how to find a user's rows. */
const TABLES = [
  ["users", schema.users, schema.users.id],
  ["shipments", schema.shipments, schema.shipments.userId],
  ["orders", schema.orders, schema.orders.userId],
  ["inbound_emails", schema.inboundEmails, schema.inboundEmails.userId],
  ["notifications", schema.notifications, schema.notifications.userId],
  [
    "notification_settings",
    schema.notificationSettings,
    schema.notificationSettings.userId,
  ],
  [
    "push_subscriptions",
    schema.pushSubscriptions,
    schema.pushSubscriptions.userId,
  ],
] as const;

let ctx: Awaited<ReturnType<typeof createTestDb>>;
let provider: ReturnType<typeof createTrackingProvider>;

beforeEach(async () => {
  ctx = await createTestDb();
  provider = createTrackingProvider({
    TRACKING_PROVIDER: "fake",
    FAKE_WEBHOOK_SECRET: "s",
  });
  reportIssue.mockReset();
});

afterEach(async () => {
  vi.restoreAllMocks();
  await ctx.client.close();
});

async function rowsOf(userId: string) {
  const counts: Record<string, number> = {};
  for (const [name, table, column] of TABLES) {
    counts[name] = (
      await ctx.db.select().from(table).where(eq(column, userId))
    ).length;
  }
  return counts;
}

const okAdmin = () => ({ deleteUser: vi.fn().mockResolvedValue(undefined) });

describe("deleteAccount", () => {
  it("removes every row of the user in every table, and nothing of anyone else's", async () => {
    const alice = await seedFullUser(ctx.db, "alice");
    const bob = await seedFullUser(ctx.db, "bob");
    const bobBefore = await rowsOf(bob.userId);
    const checkpointsBefore = (await ctx.db.select().from(schema.checkpoints))
      .length;

    const authAdmin = okAdmin();
    expect(
      await deleteAccount({
        db: ctx.db,
        provider,
        authAdmin,
        userId: alice.userId,
        now: NOW,
      }),
    ).toEqual({ status: "deleted", signInRemoved: true });

    expect(Object.values(await rowsOf(alice.userId))).toEqual(
      TABLES.map(() => 0),
    );
    expect(
      await ctx.db
        .select()
        .from(schema.checkpoints)
        .where(eq(schema.checkpoints.shipmentId, alice.shipmentId)),
    ).toHaveLength(0);
    expect(await rowsOf(bob.userId)).toEqual(bobBefore);
    expect((await ctx.db.select().from(schema.checkpoints)).length).toBe(
      checkpointsBefore - 1,
    );
    expect(authAdmin.deleteUser).toHaveBeenCalledExactlyOnceWith(alice.userId);
  });

  it("unsubscribes the user's own trackers but leaves a shared one alone", async () => {
    const alice = await seedFullUser(ctx.db, "alice", {
      trackerId: "fake:SHARED",
    });
    await seedFullUser(ctx.db, "bob", { trackerId: "fake:SHARED" });
    await ctx.db.insert(schema.shipments).values({
      userId: alice.userId,
      trackingNumber: "ALICEONLY2",
      provider: "fake",
      providerTrackerId: "fake:ALICE-ONLY",
    });
    const unsubscribe = vi.spyOn(provider, "deleteTracking");

    await deleteAccount({
      db: ctx.db,
      provider,
      authAdmin: okAdmin(),
      userId: alice.userId,
      now: NOW,
    });

    expect(unsubscribe).toHaveBeenCalledExactlyOnceWith("fake:ALICE-ONLY");
  });

  it("goes in order: trackers, then the data, then the sign-in", async () => {
    const alice = await seedFullUser(ctx.db, "alice");
    const order: string[] = [];
    vi.spyOn(provider, "deleteTracking").mockImplementation(async () => {
      order.push("tracker");
    });
    const authAdmin = {
      deleteUser: vi.fn(async () => {
        const left = await rowsOf(alice.userId);
        order.push(
          left.users === 0 ? "sign-in after data" : "sign-in before data",
        );
      }),
    };

    await deleteAccount({
      db: ctx.db,
      provider,
      authAdmin,
      userId: alice.userId,
      now: NOW,
    });

    expect(order).toEqual(["tracker", "sign-in after data"]);
  });

  it("still deletes the data when a provider call fails", async () => {
    const alice = await seedFullUser(ctx.db, "alice");
    vi.spyOn(provider, "deleteTracking").mockRejectedValue(new Error("down"));
    vi.spyOn(console, "error").mockImplementation(() => {});

    await deleteAccount({
      db: ctx.db,
      provider,
      authAdmin: okAdmin(),
      userId: alice.userId,
      now: NOW,
    });
    expect((await rowsOf(alice.userId)).users).toBe(0);
  });

  it("reports a sign-in it could not delete, and says so", async () => {
    const alice = await seedFullUser(ctx.db, "alice");
    const authAdmin = {
      deleteUser: vi.fn().mockRejectedValue(new TypeError("network")),
    };

    const result = await deleteAccount({
      db: ctx.db,
      provider,
      authAdmin,
      userId: alice.userId,
      now: NOW,
    });

    expect(result).toEqual({ status: "deleted", signInRemoved: false });
    expect((await rowsOf(alice.userId)).users).toBe(0);
    expect(reportIssue).toHaveBeenCalledExactlyOnceWith(
      "account_deletion_incomplete",
      { user_id: alice.userId, error: "typeerror" },
    );
  });

  it("refuses without the secret key, touching nothing", async () => {
    const alice = await seedFullUser(ctx.db, "alice");
    const unsubscribe = vi.spyOn(provider, "deleteTracking");
    const before = await rowsOf(alice.userId);

    expect(
      await deleteAccount({
        db: ctx.db,
        provider,
        authAdmin: null,
        userId: alice.userId,
        now: NOW,
      }),
    ).toEqual({ status: "unavailable" });
    expect(await rowsOf(alice.userId)).toEqual(before);
    expect(unsubscribe).not.toHaveBeenCalled();
  });

  it("is limited to three tries an hour", async () => {
    const alice = await seedFullUser(ctx.db, "alice");
    const authAdmin = okAdmin();
    const results = [];
    for (let i = 0; i < 4; i++) {
      results.push(
        (
          await deleteAccount({
            db: ctx.db,
            provider,
            authAdmin,
            userId: alice.userId,
            now: NOW,
          })
        ).status,
      );
    }
    expect(results).toEqual(["deleted", "deleted", "deleted", "rate_limited"]);
  });
});

describe("deleteAccount without an injected admin", () => {
  it("uses the configured one, and refuses when the secret key is not set", async () => {
    const { resetEnvCache } = await import("@/lib/env");
    const { stubRequiredEnv } = await import("../../../tests/env");
    stubRequiredEnv();
    resetEnvCache();
    const alice = await seedFullUser(ctx.db, "alice");
    expect(
      await deleteAccount({
        db: ctx.db,
        provider,
        userId: alice.userId,
        now: NOW,
      }),
    ).toEqual({ status: "unavailable" });
    vi.unstubAllEnvs();
    resetEnvCache();
  });
});
