// @vitest-environment node
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createTestDb, insertUser } from "../../../tests/db/pglite";
import {
  listPushSubscriptions,
  markPushSuccess,
  removePushSubscription,
  removePushSubscriptionById,
  savePushSubscription,
} from "./push-subscriptions";

let ctx: Awaited<ReturnType<typeof createTestDb>>;

beforeAll(async () => {
  ctx = await createTestDb();
});

afterAll(async () => {
  await ctx.client.close();
});

const NO_SUCH_ID = "99999999-9999-4999-8999-999999999999";
const device = (endpoint: string) => ({
  endpoint,
  p256dh: `key-${endpoint}`,
  auth: `auth-${endpoint}`,
});

describe("savePushSubscription / listPushSubscriptions", () => {
  it("stores a device for the user and lists only that user's devices", async () => {
    const a = await insertUser(ctx.db);
    const b = await insertUser(ctx.db);
    await savePushSubscription(ctx.db, a.id, device("https://push.test/a1"));
    await savePushSubscription(ctx.db, a.id, device("https://push.test/a2"));
    await savePushSubscription(ctx.db, b.id, device("https://push.test/b1"));

    expect(
      (await listPushSubscriptions(ctx.db, a.id)).map((d) => d.endpoint).sort(),
    ).toEqual(["https://push.test/a1", "https://push.test/a2"]);
    expect(
      (await listPushSubscriptions(ctx.db, b.id)).map((d) => d.endpoint),
    ).toEqual(["https://push.test/b1"]);
  });

  it("saving the same device twice keeps one row and refreshes its keys", async () => {
    const user = await insertUser(ctx.db);
    await savePushSubscription(ctx.db, user.id, device("https://push.test/x"));
    await savePushSubscription(ctx.db, user.id, {
      endpoint: "https://push.test/x",
      p256dh: "new-key",
      auth: "new-auth",
    });

    const rows = await listPushSubscriptions(ctx.db, user.id);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ p256dh: "new-key", auth: "new-auth" });
  });

  it("moves a device to the new user when someone else signs in on that browser", async () => {
    const first = await insertUser(ctx.db);
    const second = await insertUser(ctx.db);
    await savePushSubscription(
      ctx.db,
      first.id,
      device("https://push.test/shared"),
    );
    await savePushSubscription(
      ctx.db,
      second.id,
      device("https://push.test/shared"),
    );

    expect(await listPushSubscriptions(ctx.db, first.id)).toHaveLength(0);
    expect(
      (await listPushSubscriptions(ctx.db, second.id)).map((d) => d.endpoint),
    ).toEqual(["https://push.test/shared"]);
  });
});

describe("removePushSubscription", () => {
  it("removes the user's own device by endpoint", async () => {
    const user = await insertUser(ctx.db);
    await savePushSubscription(ctx.db, user.id, device("https://push.test/r"));
    expect(
      await removePushSubscription(ctx.db, user.id, "https://push.test/r"),
    ).toBe(true);
    expect(await listPushSubscriptions(ctx.db, user.id)).toHaveLength(0);
    expect(
      await removePushSubscription(ctx.db, user.id, "https://push.test/r"),
    ).toBe(false);
  });

  it("cannot remove another user's device, which looks exactly like a missing one", async () => {
    const owner = await insertUser(ctx.db);
    const other = await insertUser(ctx.db);
    await savePushSubscription(
      ctx.db,
      owner.id,
      device("https://push.test/mine"),
    );

    expect(
      await removePushSubscription(ctx.db, other.id, "https://push.test/mine"),
    ).toBe(false);
    expect(await listPushSubscriptions(ctx.db, owner.id)).toHaveLength(1);
  });
});

describe("removePushSubscriptionById / markPushSuccess", () => {
  it("removes by id, only for the owner, and tolerates a malformed id", async () => {
    const owner = await insertUser(ctx.db);
    const other = await insertUser(ctx.db);
    await savePushSubscription(
      ctx.db,
      owner.id,
      device("https://push.test/id"),
    );
    const [row] = await listPushSubscriptions(ctx.db, owner.id);

    expect(await removePushSubscriptionById(ctx.db, other.id, row!.id)).toBe(
      false,
    );
    expect(
      await removePushSubscriptionById(ctx.db, owner.id, "not-a-uuid"),
    ).toBe(false);
    expect(await removePushSubscriptionById(ctx.db, owner.id, NO_SUCH_ID)).toBe(
      false,
    );
    expect(await removePushSubscriptionById(ctx.db, owner.id, row!.id)).toBe(
      true,
    );
  });

  it("notes a success for the owner only", async () => {
    const owner = await insertUser(ctx.db);
    const other = await insertUser(ctx.db);
    await savePushSubscription(
      ctx.db,
      owner.id,
      device("https://push.test/ok"),
    );
    const [row] = await listPushSubscriptions(ctx.db, owner.id);
    const when = new Date("2026-06-20T12:00:00Z");

    await markPushSuccess(ctx.db, other.id, row!.id, when);
    expect(
      (await listPushSubscriptions(ctx.db, owner.id))[0]?.lastSuccessAt,
    ).toBeNull();

    await markPushSuccess(ctx.db, owner.id, row!.id, when);
    expect(
      (await listPushSubscriptions(ctx.db, owner.id))[0]?.lastSuccessAt,
    ).toEqual(when);

    await markPushSuccess(ctx.db, owner.id, "not-a-uuid", when);
  });
});
