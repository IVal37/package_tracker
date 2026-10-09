// @vitest-environment node
import { eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  createTestDb,
  insertShipment,
  insertUser,
} from "../../../tests/db/pglite";
import {
  checkpoints,
  notificationSettings,
  notifications,
  pushSubscriptions,
  shipments,
} from "@/lib/db/schema";
import {
  STALE_AFTER_MS,
  deliverEmail,
  deliverPush,
  finishDelivery,
  prepareNotification,
} from "./send";
import { FakeEmailSender, FakePushSender } from "./senders/fake";
import {
  SendError,
  type EmailMessage,
  type EmailSender,
  type PushSender,
  type PushTarget,
} from "./senders/types";

let ctx: Awaited<ReturnType<typeof createTestDb>>;

beforeAll(async () => {
  ctx = await createTestDb();
});

afterAll(async () => {
  await ctx.client.close();
});

const NOW = new Date("2026-06-20T12:00:00Z");
const APP = "https://wayfind.example.test";
const hoursAgo = (hours: number) => new Date(NOW.getTime() - hours * 3_600_000);

let seq = 0;

async function alert(
  overrides: {
    kind?: (typeof notifications.$inferInsert)["kind"];
    createdAt?: Date;
    shipment?: Partial<typeof shipments.$inferInsert>;
    status?: (typeof notifications.$inferInsert)["status"];
  } = {},
) {
  const user = await insertUser(ctx.db);
  const shipment = await insertShipment(ctx.db, user.id);
  if (overrides.shipment) {
    await ctx.db
      .update(shipments)
      .set(overrides.shipment)
      .where(eq(shipments.id, shipment.id));
  }
  const [row] = await ctx.db
    .insert(notifications)
    .values({
      userId: user.id,
      shipmentId: shipment.id,
      kind: overrides.kind ?? "delivered",
      dedupeKey: `k-${++seq}`,
      createdAt: overrides.createdAt ?? hoursAgo(1),
      status: overrides.status ?? "pending",
    })
    .returning();
  return { user, shipment, notification: row! };
}

async function addDevice(
  userId: string,
  endpoint = `https://push.test/${++seq}`,
) {
  const [row] = await ctx.db
    .insert(pushSubscriptions)
    .values({ userId, endpoint, p256dh: "key", auth: "auth" })
    .returning();
  return row!;
}

const setPrefs = (
  userId: string,
  values: Partial<typeof notificationSettings.$inferInsert>,
) => ctx.db.insert(notificationSettings).values({ userId, ...values });

const reload = async (id: string) => {
  const [row] = await ctx.db
    .select()
    .from(notifications)
    .where(eq(notifications.id, id));
  return row!;
};

const prepare = (id: string, now = NOW) =>
  prepareNotification({ db: ctx.db, id, now });

describe("prepareNotification: ready", () => {
  it("is ready for push and email when the user has a device and defaults apply", async () => {
    const { user, notification } = await alert({ kind: "delivered" });
    await addDevice(user.id);

    expect(await prepare(notification.id)).toEqual({
      outcome: "ready",
      channels: ["push", "email"],
      quietUntil: null,
    });
    expect((await reload(notification.id)).status).toBe("pending");
  });

  it("offers only push for an out-for-delivery alert, which is not emailed by default", async () => {
    const { user, notification } = await alert({ kind: "out_for_delivery" });
    await addDevice(user.id);
    expect(await prepare(notification.id)).toMatchObject({
      outcome: "ready",
      channels: ["push"],
    });
  });

  it("offers email alone when the user has no device", async () => {
    const { notification } = await alert({ kind: "problem" });
    expect(await prepare(notification.id)).toMatchObject({
      outcome: "ready",
      channels: ["email"],
    });
  });

  it("follows the user's own settings", async () => {
    const { user, notification } = await alert({ kind: "delay" });
    await addDevice(user.id);
    await setPrefs(user.id, { pushDelay: false, emailDelay: true });
    expect(await prepare(notification.id)).toMatchObject({
      channels: ["email"],
    });
  });
});

describe("prepareNotification: quiet hours", () => {
  it("returns when quiet hours end, in the user's time zone", async () => {
    const { user, notification } = await alert();
    await addDevice(user.id);
    await setPrefs(user.id, {
      quietEnabled: true,
      quietStart: 22 * 60,
      quietEnd: 7 * 60,
      timeZone: "America/Chicago",
    });
    // 03:30 UTC is 22:30 in Chicago (summer): quiet until 07:00 local = 12:00 UTC.
    const result = await prepare(
      notification.id,
      new Date("2026-06-21T03:30:00Z"),
    );
    expect(result).toMatchObject({
      outcome: "ready",
      quietUntil: "2026-06-21T12:00:00.000Z",
    });
  });

  it("sends at once outside quiet hours, or when they are off", async () => {
    const { user, notification } = await alert();
    await addDevice(user.id);
    await setPrefs(user.id, { quietEnabled: true, timeZone: "UTC" });
    // 12:00 UTC is outside 22:00 to 07:00.
    expect(await prepare(notification.id)).toMatchObject({ quietUntil: null });

    const other = await alert();
    await setPrefs(other.user.id, { quietEnabled: false });
    expect(
      await prepare(other.notification.id, new Date("2026-06-21T03:30:00Z")),
    ).toMatchObject({ quietUntil: null });
  });
});

describe("prepareNotification: skipped", () => {
  const skipped = async (id: string, reason: string) => {
    const row = await reload(id);
    expect(row.status).toBe("skipped");
    expect(row.skipReason).toBe(reason);
    expect(row.pushSent).toBe(false);
    expect(row.emailSent).toBe(false);
  };

  it("skips an alert that does not exist, or whose id is malformed, writing nothing", async () => {
    for (const id of ["99999999-9999-4999-8999-999999999999", "not-a-uuid"]) {
      expect(await prepare(id)).toEqual({
        outcome: "skipped",
        reason: "missing",
      });
    }
  });

  it("leaves an alert that is already finished alone", async () => {
    for (const status of ["sent", "skipped", "failed"] as const) {
      const { notification } = await alert({ status });
      expect(await prepare(notification.id)).toEqual({
        outcome: "skipped",
        reason: "not_pending",
      });
      expect((await reload(notification.id)).status).toBe(status);
    }
  });

  it("skips when the shipment is archived", async () => {
    const { notification } = await alert({
      shipment: { archivedAt: hoursAgo(5) },
    });
    expect(await prepare(notification.id)).toEqual({
      outcome: "skipped",
      reason: "shipment_gone",
    });
    await skipped(notification.id, "shipment_gone");
  });

  it("skips an alert more than a day old, but not one just inside the limit", async () => {
    const old = await alert({
      createdAt: new Date(NOW.getTime() - STALE_AFTER_MS - 1000),
    });
    expect(await prepare(old.notification.id)).toMatchObject({
      reason: "stale",
    });
    await skipped(old.notification.id, "stale");

    const fresh = await alert({
      createdAt: new Date(NOW.getTime() - STALE_AFTER_MS + 1000),
    });
    expect(await prepare(fresh.notification.id)).toMatchObject({
      outcome: "ready",
    });
  });

  it("skips an alert that a later one for the same shipment has superseded", async () => {
    const { user, shipment, notification } = await alert({
      kind: "out_for_delivery",
      createdAt: hoursAgo(10),
    });
    await addDevice(user.id);
    const [later] = await ctx.db
      .insert(notifications)
      .values({
        userId: user.id,
        shipmentId: shipment.id,
        kind: "delivered",
        dedupeKey: "later",
        createdAt: hoursAgo(2),
      })
      .returning();

    expect(await prepare(notification.id)).toMatchObject({
      reason: "superseded",
    });
    await skipped(notification.id, "superseded");
    // The newer one is not itself superseded.
    expect(await prepare(later!.id)).toMatchObject({ outcome: "ready" });
  });

  it("does not count another shipment's later alert as superseding", async () => {
    const { user, notification } = await alert({ createdAt: hoursAgo(10) });
    await addDevice(user.id);
    const otherShipment = await insertShipment(ctx.db, user.id);
    await ctx.db.insert(notifications).values({
      userId: user.id,
      shipmentId: otherShipment.id,
      kind: "delivered",
      dedupeKey: "other",
      createdAt: hoursAgo(1),
    });
    expect(await prepare(notification.id)).toMatchObject({ outcome: "ready" });
  });

  it("skips when every channel is switched off for the kind", async () => {
    const { user, notification } = await alert({ kind: "delivered" });
    await addDevice(user.id);
    await setPrefs(user.id, { pushDelivered: false, emailDelivered: false });
    expect(await prepare(notification.id)).toMatchObject({
      reason: "channels_off",
    });
    await skipped(notification.id, "channels_off");
  });

  it("skips when push is the only channel on but the user has no device", async () => {
    const { notification } = await alert({ kind: "out_for_delivery" });
    expect(await prepare(notification.id)).toMatchObject({
      reason: "no_destination",
    });
    await skipped(notification.id, "no_destination");
  });

  it("a second run after a skip changes nothing", async () => {
    const { notification } = await alert({ kind: "out_for_delivery" });
    await prepare(notification.id);
    expect(await prepare(notification.id)).toEqual({
      outcome: "skipped",
      reason: "not_pending",
    });
    await skipped(notification.id, "no_destination");
  });
});

describe("isolation between users", () => {
  it("does not use another user's devices or settings to decide", async () => {
    const a = await alert({ kind: "out_for_delivery" });
    const b = await alert({ kind: "out_for_delivery" });
    await addDevice(b.user.id);
    // B turns push off for this kind; A (defaults) has no device.
    await setPrefs(b.user.id, { pushOutForDelivery: false });

    expect(await prepare(a.notification.id)).toMatchObject({
      reason: "no_destination",
    });
  });

  it("sends an alert only to its owner's devices and address", async () => {
    const a = await alert({ kind: "delivered" });
    const b = await alert({ kind: "delivered" });
    const deviceA = await addDevice(a.user.id, "https://push.test/owner-a");
    await addDevice(b.user.id, "https://push.test/owner-b");
    const push = new FakePushSender();
    const mail = new FakeEmailSender();

    await deliverPush({
      db: ctx.db,
      sender: push,
      id: a.notification.id,
      appUrl: APP,
      now: NOW,
    });
    await deliverEmail({
      db: ctx.db,
      sender: mail,
      id: a.notification.id,
      appUrl: APP,
    });

    expect(push.sent.map((s) => s.target.endpoint)).toEqual([deviceA.endpoint]);
    expect(mail.sent.map((m) => m.to)).toEqual([a.user.email]);
    expect(JSON.stringify(push.sent)).not.toContain(b.shipment.id);
  });
});

describe("deliverPush", () => {
  it("sends the built message to every device and notes the success", async () => {
    const { user, shipment, notification } = await alert({
      kind: "delivered",
      shipment: { nickname: "Merino socks", status: "Delivered" },
    });
    await ctx.db.insert(checkpoints).values({
      shipmentId: shipment.id,
      providerEventId: "e1",
      occurredAt: hoursAgo(2),
      status: "Delivered",
      message: "Left at front door",
      locationText: "MEMPHIS, TN",
    });
    const one = await addDevice(user.id, "https://push.test/one");
    await addDevice(user.id, "https://push.test/two");
    const sender = new FakePushSender();

    const result = await deliverPush({
      db: ctx.db,
      sender,
      id: notification.id,
      appUrl: APP,
      now: NOW,
    });

    expect(result).toEqual({ attempted: 2, sent: 2, gone: 0, failed: 0 });
    expect(sender.sent).toHaveLength(2);
    expect(sender.sent[0]?.payload).toEqual({
      title: "Delivered: Merino socks",
      body: "Left at front door · MEMPHIS, TN",
      url: `${APP}/?shipment=${shipment.id}`,
      tag: `shipment-${shipment.id}`,
    });
    const [saved] = await ctx.db
      .select()
      .from(pushSubscriptions)
      .where(eq(pushSubscriptions.id, one.id));
    expect(saved?.lastSuccessAt).toEqual(NOW);
  });

  it("deletes a device the push service says is gone, and still reaches the others", async () => {
    const { user, notification } = await alert();
    const gone = await addDevice(user.id, "https://push.test/gone");
    const live = await addDevice(user.id, "https://push.test/live");
    const sender = new FakePushSender();
    sender.goneEndpoints.add(gone.endpoint);

    const result = await deliverPush({
      db: ctx.db,
      sender,
      id: notification.id,
      appUrl: APP,
      now: NOW,
    });

    expect(result).toEqual({ attempted: 2, sent: 1, gone: 1, failed: 0 });
    const left = await ctx.db
      .select()
      .from(pushSubscriptions)
      .where(eq(pushSubscriptions.userId, user.id));
    expect(left.map((d) => d.id)).toEqual([live.id]);
  });

  const failing = (error: SendError): PushSender => ({
    name: "fake",
    send: async () => {
      throw error;
    },
  });

  it("throws a retryable error when nothing got through and a retry could help", async () => {
    const { user, notification } = await alert();
    await addDevice(user.id);
    const error = new SendError("busy", { retryable: true, status: 503 });

    await expect(
      deliverPush({
        db: ctx.db,
        sender: failing(error),
        id: notification.id,
        appUrl: APP,
        now: NOW,
      }),
    ).rejects.toBe(error);
  });

  it("counts a permanent refusal as failed without throwing", async () => {
    const { user, notification } = await alert();
    await addDevice(user.id);
    const result = await deliverPush({
      db: ctx.db,
      sender: failing(new SendError("no", { retryable: false, status: 403 })),
      id: notification.id,
      appUrl: APP,
      now: NOW,
    });
    expect(result).toEqual({ attempted: 1, sent: 0, gone: 0, failed: 1 });
  });

  it("accepts partial success instead of retrying, which would buzz the working device twice", async () => {
    const { user, notification } = await alert();
    const bad = await addDevice(user.id, "https://push.test/bad");
    await addDevice(user.id, "https://push.test/good");
    const sender: PushSender = {
      name: "fake",
      send: async (target: PushTarget) => {
        if (target.endpoint === bad.endpoint) {
          throw new SendError("busy", { retryable: true });
        }
        return "sent";
      },
    };

    const result = await deliverPush({
      db: ctx.db,
      sender,
      id: notification.id,
      appUrl: APP,
      now: NOW,
    });
    expect(result).toEqual({ attempted: 2, sent: 1, gone: 0, failed: 0 });
  });

  it("does not swallow an error that is not a SendError", async () => {
    const { user, notification } = await alert();
    await addDevice(user.id);
    const sender: PushSender = {
      name: "fake",
      send: async () => {
        throw new TypeError("bug");
      },
    };
    await expect(
      deliverPush({
        db: ctx.db,
        sender,
        id: notification.id,
        appUrl: APP,
        now: NOW,
      }),
    ).rejects.toThrow("bug");
  });

  it("returns zeros for an alert that is gone", async () => {
    const sender = new FakePushSender();
    expect(
      await deliverPush({
        db: ctx.db,
        sender,
        id: "99999999-9999-4999-8999-999999999999",
        appUrl: APP,
        now: NOW,
      }),
    ).toEqual({ attempted: 0, sent: 0, gone: 0, failed: 0 });
    expect(sender.sent).toHaveLength(0);
  });
});

describe("deliverEmail", () => {
  it("emails the account address, with the alert id as the idempotency key", async () => {
    const { user, shipment, notification } = await alert({
      kind: "problem",
      shipment: {
        nickname: "Desk lamp",
        status: "Exception",
        trackingNumber: "1Z999AA10123456784",
      },
    });
    const sender = new FakeEmailSender();

    const result = await deliverEmail({
      db: ctx.db,
      sender,
      id: notification.id,
      appUrl: APP,
    });

    expect(result).toEqual({ attempted: 1, sent: 1, failed: 0 });
    const [message] = sender.sent;
    expect(message).toMatchObject({
      to: user.email,
      idempotencyKey: notification.id,
      subject: "Delivery problem: Desk lamp",
    });
    expect(message?.text).toContain("Tracking number: 1Z999AA10123456784");
    expect(message?.text).toContain(`${APP}/?shipment=${shipment.id}`);
  });

  it("sends once however many times it runs, like the real service", async () => {
    const { notification } = await alert();
    const sender = new FakeEmailSender();
    await deliverEmail({
      db: ctx.db,
      sender,
      id: notification.id,
      appUrl: APP,
    });
    await deliverEmail({
      db: ctx.db,
      sender,
      id: notification.id,
      appUrl: APP,
    });
    expect(sender.sent).toHaveLength(1);
  });

  it("throws a retryable error and returns a permanent refusal", async () => {
    const { notification } = await alert();
    const retry = new SendError("busy", { retryable: true, status: 429 });
    const refusing = (error: SendError): EmailSender => ({
      name: "fake",
      send: async (_message: EmailMessage) => {
        throw error;
      },
    });

    await expect(
      deliverEmail({
        db: ctx.db,
        sender: refusing(retry),
        id: notification.id,
        appUrl: APP,
      }),
    ).rejects.toBe(retry);
    expect(
      await deliverEmail({
        db: ctx.db,
        sender: refusing(
          new SendError("bad address", { retryable: false, status: 422 }),
        ),
        id: notification.id,
        appUrl: APP,
      }),
    ).toEqual({ attempted: 1, sent: 0, failed: 1 });
  });

  it("does not swallow an error that is not a SendError", async () => {
    const { notification } = await alert();
    const sender: EmailSender = {
      name: "fake",
      send: async () => {
        throw new TypeError("bug");
      },
    };
    await expect(
      deliverEmail({ db: ctx.db, sender, id: notification.id, appUrl: APP }),
    ).rejects.toThrow("bug");
  });

  it("does nothing for an alert that is gone", async () => {
    const sender = new FakeEmailSender();
    expect(
      await deliverEmail({
        db: ctx.db,
        sender,
        id: "99999999-9999-4999-8999-999999999999",
        appUrl: APP,
      }),
    ).toEqual({ attempted: 0, sent: 0, failed: 0 });
  });
});

describe("finishDelivery", () => {
  const push = (sent: number, failed = 0) => ({
    attempted: sent + failed,
    sent,
    gone: 0,
    failed,
  });
  const email = (sent: number, failed = 0) => ({
    attempted: sent + failed,
    sent,
    failed,
  });

  it("marks sent when any channel got through, recording which", async () => {
    const { notification } = await alert();
    const status = await finishDelivery({
      db: ctx.db,
      id: notification.id,
      now: NOW,
      push: push(0, 1),
      email: email(1),
    });
    expect(status).toBe("sent");
    const row = await reload(notification.id);
    expect(row).toMatchObject({
      status: "sent",
      pushSent: false,
      emailSent: true,
      sentAt: NOW,
    });
  });

  it("marks failed when a channel refused for good and nothing got through", async () => {
    const { notification } = await alert();
    expect(
      await finishDelivery({
        db: ctx.db,
        id: notification.id,
        now: NOW,
        email: email(0, 1),
      }),
    ).toBe("failed");
    expect((await reload(notification.id)).status).toBe("failed");
  });

  it("marks skipped when every device was gone and nothing else was tried", async () => {
    const { notification } = await alert();
    expect(
      await finishDelivery({
        db: ctx.db,
        id: notification.id,
        now: NOW,
        push: { attempted: 1, sent: 0, gone: 1, failed: 0 },
      }),
    ).toBe("skipped");
    expect(await reload(notification.id)).toMatchObject({
      status: "skipped",
      skipReason: "no_destination",
    });
  });

  it("never overwrites an outcome that was already recorded", async () => {
    const { notification } = await alert();
    await finishDelivery({
      db: ctx.db,
      id: notification.id,
      now: NOW,
      push: push(1),
    });
    await finishDelivery({
      db: ctx.db,
      id: notification.id,
      now: NOW,
      email: email(0, 1),
    });
    expect(await reload(notification.id)).toMatchObject({
      status: "sent",
      pushSent: true,
      emailSent: false,
    });
  });
});
