// "Send a test" on the settings page: a push to the user's own devices, so they
// can see it works before a real alert depends on it.
import type { Db } from "@/lib/db/client";
import {
  listPushSubscriptions,
  markPushSuccess,
  removePushSubscriptionById,
} from "@/lib/db/push-subscriptions";
import { createRateLimiter, type RateLimiter } from "./rate-limit";
import { SendError, type PushSender } from "./senders";

export type TestPushResult =
  | { status: "sent"; devices: number }
  | { status: "no_devices" }
  | { status: "rate_limited" }
  | { status: "failed" };

/** Three tests a minute per user is plenty for someone checking their setup. */
const limiter = createRateLimiter({ limit: 3, windowMs: 60_000 });

/**
 * Sends a test notification to each of the user's devices. Only that user's own
 * devices are ever read. A device the push service reports gone is removed.
 */
export async function sendTestPush(args: {
  db: Db;
  sender: PushSender;
  userId: string;
  appUrl: string;
  now: Date;
  rateLimiter?: RateLimiter;
}): Promise<TestPushResult> {
  const { db, sender, userId, appUrl, now } = args;
  if (!(args.rateLimiter ?? limiter).take(userId, now)) {
    return { status: "rate_limited" };
  }

  const devices = await listPushSubscriptions(db, userId);
  if (devices.length === 0) return { status: "no_devices" };

  const payload = {
    title: "Wayfind test",
    body: "Notifications are working on this device.",
    url: `${appUrl.replace(/\/+$/, "")}/settings`,
    tag: "wayfind-test",
  };

  let sent = 0;
  for (const device of devices) {
    try {
      const answer = await sender.send(
        { endpoint: device.endpoint, p256dh: device.p256dh, auth: device.auth },
        payload,
      );
      if (answer === "gone") {
        await removePushSubscriptionById(db, userId, device.id);
      } else {
        sent += 1;
        await markPushSuccess(db, userId, device.id, now);
      }
    } catch (error) {
      if (!(error instanceof SendError)) throw error;
    }
  }
  return sent > 0 ? { status: "sent", devices: sent } : { status: "failed" };
}
