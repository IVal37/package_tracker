// @vitest-environment node
import { InngestTestEngine } from "@inngest/test";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  prepareNotification: vi.fn(),
  deliverPush: vi.fn(),
  deliverEmail: vi.fn(),
  finishDelivery: vi.fn(),
  sweepNotifications: vi.fn(),
  cleanupNotifications: vi.fn(),
}));

vi.mock("@/lib/db/client", () => ({ getDb: () => "db" }));
vi.mock("@/lib/env", () => ({
  getEnv: () => ({ APP_URL: "https://wayfind.example.test" }),
}));
vi.mock("@/lib/notifications/send", () => ({
  prepareNotification: mocks.prepareNotification,
  deliverPush: mocks.deliverPush,
  deliverEmail: mocks.deliverEmail,
  finishDelivery: mocks.finishDelivery,
}));
vi.mock("@/lib/notifications/maintenance", () => ({
  sweepNotifications: mocks.sweepNotifications,
  cleanupNotifications: mocks.cleanupNotifications,
}));
vi.mock("@/lib/notifications/senders", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/notifications/senders")>()),
  getPushSender: () => "push-sender",
  getEmailSender: () => "email-sender",
}));

import { SendError } from "@/lib/notifications/senders";
import {
  notificationsCleanup,
  notificationsSweep,
  sendNotificationJob,
} from "./notifications";

const ID = "11111111-1111-4111-8111-111111111111";
const ID_B = "22222222-2222-4222-8222-222222222222";

const event = (data: unknown) => ({
  name: "wayfind/notification.created",
  data: data as never,
});

const ready = (
  channels: ("push" | "email")[],
  quietUntil: string | null = null,
) => ({ outcome: "ready" as const, channels, quietUntil });

const PUSH_OK = { attempted: 2, sent: 2, gone: 0, failed: 0 };
const EMAIL_OK = { attempted: 1, sent: 1, failed: 0 };

beforeEach(() => {
  for (const mock of Object.values(mocks)) mock.mockReset();
  mocks.finishDelivery.mockResolvedValue("sent");
});

describe("send-notification: configuration", () => {
  it("is triggered by the notification.created event, one run per alert, with retries", () => {
    expect(sendNotificationJob.opts.triggers).toEqual([
      { event: "wayfind/notification.created" },
    ]);
    expect(sendNotificationJob.opts.concurrency).toEqual({
      limit: 1,
      key: "event.data.notificationId",
    });
    expect(sendNotificationJob.opts.retries).toBe(4);
  });

  it.each([{}, { notificationId: "" }, { notificationId: "nope" }, null])(
    "refuses an event with data %j, without retrying",
    async (data) => {
      const { error } = await new InngestTestEngine({
        function: sendNotificationJob,
      }).execute({ events: [event(data)] });
      expect(error).toMatchObject({
        name: "NonRetriableError",
        message: "Invalid notification event",
      });
      expect(mocks.prepareNotification).not.toHaveBeenCalled();
    },
  );
});

describe("send-notification: delivery", () => {
  it("sends push, then email, then records the outcome", async () => {
    mocks.prepareNotification.mockResolvedValue(ready(["push", "email"]));
    mocks.deliverPush.mockResolvedValue(PUSH_OK);
    mocks.deliverEmail.mockResolvedValue(EMAIL_OK);

    const { result } = await new InngestTestEngine({
      function: sendNotificationJob,
    }).execute({ events: [event({ notificationId: ID })] });

    expect(result).toEqual({
      outcome: "sent",
      push: PUSH_OK,
      email: EMAIL_OK,
    });
    expect(mocks.prepareNotification).toHaveBeenCalledWith({
      db: "db",
      id: ID,
      now: expect.any(Date),
    });
    expect(mocks.deliverPush).toHaveBeenCalledExactlyOnceWith({
      db: "db",
      sender: "push-sender",
      id: ID,
      appUrl: "https://wayfind.example.test",
      now: expect.any(Date),
    });
    expect(mocks.deliverEmail).toHaveBeenCalledExactlyOnceWith({
      db: "db",
      sender: "email-sender",
      id: ID,
      appUrl: "https://wayfind.example.test",
    });
    expect(mocks.finishDelivery).toHaveBeenCalledExactlyOnceWith({
      db: "db",
      id: ID,
      now: expect.any(Date),
      push: PUSH_OK,
      email: EMAIL_OK,
    });
  });

  it("touches only the channels it was told to", async () => {
    mocks.prepareNotification.mockResolvedValue(ready(["push"]));
    mocks.deliverPush.mockResolvedValue(PUSH_OK);

    await new InngestTestEngine({ function: sendNotificationJob }).execute({
      events: [event({ notificationId: ID })],
    });

    expect(mocks.deliverEmail).not.toHaveBeenCalled();
    expect(mocks.finishDelivery).toHaveBeenCalledWith(
      expect.objectContaining({ push: PUSH_OK, email: undefined }),
    );

    mocks.prepareNotification.mockResolvedValue(ready(["email"]));
    mocks.deliverEmail.mockResolvedValue(EMAIL_OK);
    mocks.deliverPush.mockClear();
    await new InngestTestEngine({ function: sendNotificationJob }).execute({
      events: [event({ notificationId: ID })],
    });
    expect(mocks.deliverPush).not.toHaveBeenCalled();
  });

  it("stops when the alert is skipped, sending nothing", async () => {
    mocks.prepareNotification.mockResolvedValue({
      outcome: "skipped",
      reason: "superseded",
    });

    const { result } = await new InngestTestEngine({
      function: sendNotificationJob,
    }).execute({ events: [event({ notificationId: ID })] });

    expect(result).toEqual({ outcome: "skipped", reason: "superseded" });
    expect(mocks.deliverPush).not.toHaveBeenCalled();
    expect(mocks.deliverEmail).not.toHaveBeenCalled();
    expect(mocks.finishDelivery).not.toHaveBeenCalled();
  });

  it("logs counts only", async () => {
    const info = vi.spyOn(console, "info").mockImplementation(() => {});
    mocks.prepareNotification.mockResolvedValue(ready(["push", "email"]));
    mocks.deliverPush.mockResolvedValue(PUSH_OK);
    mocks.deliverEmail.mockResolvedValue(EMAIL_OK);

    await new InngestTestEngine({ function: sendNotificationJob }).execute({
      events: [event({ notificationId: ID })],
    });

    const logged = JSON.stringify(info.mock.calls);
    expect(logged).toContain('"outcome":"sent"');
    expect(logged).not.toContain(ID);
    info.mockRestore();
  });
});

describe("send-notification: quiet hours", () => {
  const UNTIL = "2026-06-11T12:00:00.000Z";

  it("sleeps until quiet hours end, then decides again before sending", async () => {
    mocks.prepareNotification
      .mockResolvedValueOnce(ready(["push"], UNTIL))
      .mockResolvedValueOnce(ready(["push"], null));
    mocks.deliverPush.mockResolvedValue(PUSH_OK);

    const { ctx } = await new InngestTestEngine({
      function: sendNotificationJob,
    }).execute({
      events: [event({ notificationId: ID })],
      steps: [{ id: "quiet-hours-1", handler: () => undefined }],
    });

    expect(ctx.step.sleepUntil).toHaveBeenCalledExactlyOnceWith(
      "quiet-hours-1",
      UNTIL,
    );
    expect(mocks.prepareNotification).toHaveBeenCalledTimes(2);
    expect(mocks.deliverPush).toHaveBeenCalledOnce();
  });

  it("drops the alert if, after the wait, it has become pointless", async () => {
    mocks.prepareNotification
      .mockResolvedValueOnce(ready(["push"], UNTIL))
      .mockResolvedValueOnce({ outcome: "skipped", reason: "superseded" });

    const { result } = await new InngestTestEngine({
      function: sendNotificationJob,
    }).execute({
      events: [event({ notificationId: ID })],
      steps: [{ id: "quiet-hours-1", handler: () => undefined }],
    });

    expect(result).toEqual({ outcome: "skipped", reason: "superseded" });
    expect(mocks.deliverPush).not.toHaveBeenCalled();
  });

  it("waits at most twice, then sends rather than holding the alert for ever", async () => {
    mocks.prepareNotification.mockResolvedValue(ready(["push"], UNTIL));
    mocks.deliverPush.mockResolvedValue(PUSH_OK);

    const { ctx } = await new InngestTestEngine({
      function: sendNotificationJob,
    }).execute({
      events: [event({ notificationId: ID })],
      steps: [
        { id: "quiet-hours-1", handler: () => undefined },
        { id: "quiet-hours-2", handler: () => undefined },
      ],
    });

    expect(ctx.step.sleepUntil).toHaveBeenCalledTimes(2);
    expect(mocks.prepareNotification).toHaveBeenCalledTimes(3);
    expect(mocks.deliverPush).toHaveBeenCalledOnce();
  });
});

describe("send-notification: failures", () => {
  // The fifth and last of five attempts.
  const lastAttemptEngine = () =>
    new InngestTestEngine({
      function: sendNotificationJob,
      transformCtx: (ctx) => ({ ...ctx, attempt: 4, maxAttempts: 5 }),
    });
  const retryable = () =>
    new SendError("busy", { retryable: true, status: 503 });

  it("lets a temporary push failure through so Inngest retries that step", async () => {
    mocks.prepareNotification.mockResolvedValue(ready(["push", "email"]));
    mocks.deliverPush.mockRejectedValue(retryable());

    const { error } = await new InngestTestEngine({
      function: sendNotificationJob,
    }).execute({ events: [event({ notificationId: ID })] });

    expect(error).toBeDefined();
    expect(mocks.deliverEmail).not.toHaveBeenCalled();
    expect(mocks.finishDelivery).not.toHaveBeenCalled();
  });

  it("on the last attempt, counts the push as failed and carries on to the email", async () => {
    mocks.prepareNotification.mockResolvedValue(ready(["push", "email"]));
    mocks.deliverPush.mockRejectedValue(retryable());
    mocks.deliverEmail.mockResolvedValue(EMAIL_OK);

    const { error } = await lastAttemptEngine().execute({
      events: [event({ notificationId: ID })],
    });

    expect(error).toBeUndefined();
    expect(mocks.finishDelivery).toHaveBeenCalledWith(
      expect.objectContaining({
        push: { attempted: 1, sent: 0, gone: 0, failed: 1 },
        email: EMAIL_OK,
      }),
    );
  });

  it("on the last attempt, counts a temporary email failure as failed", async () => {
    mocks.prepareNotification.mockResolvedValue(ready(["email"]));
    mocks.deliverEmail.mockRejectedValue(retryable());

    await lastAttemptEngine().execute({
      events: [event({ notificationId: ID })],
    });

    expect(mocks.finishDelivery).toHaveBeenCalledWith(
      expect.objectContaining({
        email: { attempted: 1, sent: 0, failed: 1 },
      }),
    );
  });

  it("does not hide a bug, even on the last attempt", async () => {
    mocks.prepareNotification.mockResolvedValue(ready(["push"]));
    mocks.deliverPush.mockRejectedValue(new TypeError("bug"));

    const { error } = await lastAttemptEngine().execute({
      events: [event({ notificationId: ID })],
    });

    expect(error).toBeDefined();
    expect(mocks.finishDelivery).not.toHaveBeenCalled();
  });
});

describe("notifications-sweep", () => {
  it("runs hourly, one at a time", () => {
    expect(notificationsSweep.opts.triggers).toEqual([{ cron: "25 * * * *" }]);
    expect(notificationsSweep.opts.concurrency).toBe(1);
  });

  it("queues new overdue alerts and re-queues lost ones, with the right event ids", async () => {
    mocks.sweepNotifications.mockResolvedValue({ fresh: [ID], retry: [ID_B] });

    const { result, ctx } = await new InngestTestEngine({
      function: notificationsSweep,
    }).execute({
      steps: [
        { id: "queue-new", handler: () => ({ ids: [] }) },
        { id: "queue-retry", handler: () => ({ ids: [] }) },
      ],
    });

    expect(result).toEqual({ recorded: 1, requeued: 1 });
    expect(mocks.sweepNotifications).toHaveBeenCalledWith({
      db: "db",
      now: expect.any(Date),
      limit: 200,
    });
    expect(ctx.step.sendEvent).toHaveBeenCalledWith("queue-new", [
      {
        id: `notification-${ID}`,
        name: "wayfind/notification.created",
        data: { notificationId: ID },
      },
    ]);
    expect(ctx.step.sendEvent).toHaveBeenCalledWith("queue-retry", [
      expect.objectContaining({
        id: expect.stringMatching(
          new RegExp(`^notification-${ID_B}-sweep-\\d+$`),
        ),
        data: { notificationId: ID_B },
      }),
    ]);
  });

  it("sends nothing when there is nothing to do", async () => {
    mocks.sweepNotifications.mockResolvedValue({ fresh: [], retry: [] });
    const { result, ctx } = await new InngestTestEngine({
      function: notificationsSweep,
    }).execute();
    expect(result).toEqual({ recorded: 0, requeued: 0 });
    expect(ctx.step.sendEvent).not.toHaveBeenCalled();
  });
});

describe("notifications-cleanup", () => {
  it("runs daily at 03:50 UTC, one at a time", () => {
    expect(notificationsCleanup.opts.triggers).toEqual([
      { cron: "TZ=UTC 50 3 * * *" },
    ]);
    expect(notificationsCleanup.opts.concurrency).toBe(1);
  });

  it("deletes old alerts and returns the count", async () => {
    mocks.cleanupNotifications.mockResolvedValue({ deleted: 7 });
    const { result } = await new InngestTestEngine({
      function: notificationsCleanup,
    }).execute();
    expect(result).toEqual({ deleted: 7 });
    expect(mocks.cleanupNotifications).toHaveBeenCalledWith({
      db: "db",
      now: expect.any(Date),
    });
  });
});
