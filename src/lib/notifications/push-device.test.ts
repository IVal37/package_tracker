import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Db } from "@/lib/db/client";
import type { PushSubscriptionRow } from "@/lib/db/push-subscriptions";

const { markPushSuccess, removePushSubscriptionById } = vi.hoisted(() => ({
  markPushSuccess: vi.fn(),
  removePushSubscriptionById: vi.fn(),
}));
vi.mock("@/lib/db/push-subscriptions", () => ({
  markPushSuccess,
  removePushSubscriptionById,
}));

import { pushToDevice } from "./push-device";
import { SendError, type PushSender } from "./senders";

const db = {} as Db;
const now = new Date("2026-06-10T12:00:00Z");
const device = {
  id: "device-1",
  endpoint: "https://push.example/1",
  p256dh: "key",
  auth: "secret",
} as PushSubscriptionRow;
const payload = { title: "T", body: "B", url: "/", tag: "t" };

const senderAnswering = (send: PushSender["send"]): PushSender => ({
  name: "fake",
  send,
});
const args = (sender: PushSender) => ({
  db,
  sender,
  userId: "user-1",
  device,
  payload,
  now,
});

beforeEach(() => {
  markPushSuccess.mockReset();
  removePushSubscriptionById.mockReset();
});

describe("pushToDevice", () => {
  it("sends to the device and marks it reached", async () => {
    const send = vi.fn(async () => "sent" as const);
    expect(await pushToDevice(args(senderAnswering(send)))).toBe("sent");
    expect(send).toHaveBeenCalledWith(
      {
        endpoint: "https://push.example/1",
        p256dh: "key",
        auth: "secret",
      },
      payload,
    );
    expect(markPushSuccess).toHaveBeenCalledWith(db, "user-1", "device-1", now);
    expect(removePushSubscriptionById).not.toHaveBeenCalled();
  });

  it("deletes a device the push service says is gone", async () => {
    const sender = senderAnswering(async () => "gone");
    expect(await pushToDevice(args(sender))).toBe("gone");
    expect(removePushSubscriptionById).toHaveBeenCalledWith(
      db,
      "user-1",
      "device-1",
    );
    expect(markPushSuccess).not.toHaveBeenCalled();
  });

  it("passes a send failure on and leaves the device alone", async () => {
    const failure = new SendError("refused", { retryable: false });
    const sender = senderAnswering(async () => {
      throw failure;
    });
    await expect(pushToDevice(args(sender))).rejects.toBe(failure);
    expect(markPushSuccess).not.toHaveBeenCalled();
    expect(removePushSubscriptionById).not.toHaveBeenCalled();
  });
});
