import type { Db } from "@/lib/db/client";
import {
  markPushSuccess,
  removePushSubscriptionById,
  type PushSubscriptionRow,
} from "@/lib/db/push-subscriptions";
import type { PushPayload, PushResult, PushSender } from "./senders";

/**
 * Sends one push to one of the user's devices and keeps its row current: a
 * device the push service reports gone is deleted, one that took the push is
 * marked as reached. Throws SendError as the sender does.
 */
export async function pushToDevice(args: {
  db: Db;
  sender: PushSender;
  userId: string;
  device: PushSubscriptionRow;
  payload: PushPayload;
  now: Date;
}): Promise<PushResult> {
  const { db, sender, userId, device, payload, now } = args;
  const answer = await sender.send(
    { endpoint: device.endpoint, p256dh: device.p256dh, auth: device.auth },
    payload,
  );
  if (answer === "gone") {
    await removePushSubscriptionById(db, userId, device.id);
  } else {
    await markPushSuccess(db, userId, device.id, now);
  }
  return answer;
}
