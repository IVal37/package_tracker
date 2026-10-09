// @vitest-environment node
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createTestDb, insertUser } from "../../../tests/db/pglite";
import {
  listPushSubscriptions,
  savePushSubscription,
} from "@/lib/db/push-subscriptions";
import { createRateLimiter } from "./rate-limit";
import { SendError, type PushSender } from "./senders";
import { FakePushSender } from "./senders/fake";
import { sendTestPush } from "./test-push";

let ctx: Awaited<ReturnType<typeof createTestDb>>;

beforeAll(async () => {
  ctx = await createTestDb();
});

afterAll(async () => {
  await ctx.client.close();
});

const NOW = new Date("2026-06-20T12:00:00Z");
const APP = "https://wayfind.example.test";
const device = (endpoint: string) => ({
  endpoint,
  p256dh: "key",
  auth: "auth",
});
const fresh = () => createRateLimiter({ limit: 3, windowMs: 60_000 });

const run = (userId: string, sender: PushSender, rateLimiter = fresh()) =>
  sendTestPush({
    db: ctx.db,
    sender,
    userId,
    appUrl: APP,
    now: NOW,
    rateLimiter,
  });

describe("sendTestPush", () => {
  it("sends a test to each of the user's devices", async () => {
    const user = await insertUser(ctx.db);
    await savePushSubscription(ctx.db, user.id, device("https://push.test/a"));
    await savePushSubscription(ctx.db, user.id, device("https://push.test/b"));
    const sender = new FakePushSender();

    expect(await run(user.id, sender)).toEqual({ status: "sent", devices: 2 });
    expect(sender.sent).toHaveLength(2);
    expect(sender.sent[0]?.payload).toEqual({
      title: "Wayfind test",
      body: "Notifications are working on this device.",
      url: `${APP}/settings`,
      tag: "wayfind-test",
    });
  });

  it("never reaches another user's devices", async () => {
    const mine = await insertUser(ctx.db);
    const theirs = await insertUser(ctx.db);
    await savePushSubscription(
      ctx.db,
      mine.id,
      device("https://push.test/mine"),
    );
    await savePushSubscription(
      ctx.db,
      theirs.id,
      device("https://push.test/theirs"),
    );
    const sender = new FakePushSender();

    await run(mine.id, sender);

    expect(sender.sent.map((s) => s.target.endpoint)).toEqual([
      "https://push.test/mine",
    ]);
  });

  it("says so when there is no device", async () => {
    const user = await insertUser(ctx.db);
    expect(await run(user.id, new FakePushSender())).toEqual({
      status: "no_devices",
    });
  });

  it("is limited to three a minute per user", async () => {
    const user = await insertUser(ctx.db);
    const other = await insertUser(ctx.db);
    await savePushSubscription(ctx.db, user.id, device("https://push.test/l1"));
    await savePushSubscription(
      ctx.db,
      other.id,
      device("https://push.test/l2"),
    );
    const limiter = fresh();
    const sender = new FakePushSender();

    const results = [];
    for (let i = 0; i < 5; i++)
      results.push(await run(user.id, sender, limiter));
    expect(results.map((r) => r.status)).toEqual([
      "sent",
      "sent",
      "sent",
      "rate_limited",
      "rate_limited",
    ]);
    // Someone else is not held up by it.
    expect((await run(other.id, sender, limiter)).status).toBe("sent");
    expect(sender.sent).toHaveLength(4);
  });

  it("removes a device the push service says is gone", async () => {
    const user = await insertUser(ctx.db);
    await savePushSubscription(
      ctx.db,
      user.id,
      device("https://push.test/gone"),
    );
    await savePushSubscription(
      ctx.db,
      user.id,
      device("https://push.test/live"),
    );
    const sender = new FakePushSender();
    sender.goneEndpoints.add("https://push.test/gone");

    expect(await run(user.id, sender)).toEqual({ status: "sent", devices: 1 });
    expect(
      (await listPushSubscriptions(ctx.db, user.id)).map((d) => d.endpoint),
    ).toEqual(["https://push.test/live"]);
  });

  it("reports failure when no device could be reached", async () => {
    const user = await insertUser(ctx.db);
    await savePushSubscription(
      ctx.db,
      user.id,
      device("https://push.test/down"),
    );
    const sender: PushSender = {
      name: "fake",
      send: async () => {
        throw new SendError("busy", { retryable: true, status: 503 });
      },
    };
    expect(await run(user.id, sender)).toEqual({ status: "failed" });
  });

  it("reports failure when every device was gone", async () => {
    const user = await insertUser(ctx.db);
    await savePushSubscription(ctx.db, user.id, device("https://push.test/g1"));
    const sender = new FakePushSender();
    sender.goneEndpoints.add("https://push.test/g1");
    expect(await run(user.id, sender)).toEqual({ status: "failed" });
  });

  it("does not hide a bug", async () => {
    const user = await insertUser(ctx.db);
    await savePushSubscription(
      ctx.db,
      user.id,
      device("https://push.test/bug"),
    );
    const sender: PushSender = {
      name: "fake",
      send: async () => {
        throw new TypeError("bug");
      },
    };
    await expect(run(user.id, sender)).rejects.toThrow("bug");
  });

  it("works with the default limiter too", async () => {
    const user = await insertUser(ctx.db);
    const result = await sendTestPush({
      db: ctx.db,
      sender: new FakePushSender(),
      userId: user.id,
      appUrl: `${APP}/`,
      now: NOW,
    });
    expect(result).toEqual({ status: "no_devices" });
  });
});
