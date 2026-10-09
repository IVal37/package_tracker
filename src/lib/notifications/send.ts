// Delivering one recorded alert. The job (src/jobs/notifications.ts) calls these
// in order as separate steps, so a retry of one channel never repeats another:
//
//   prepareNotification -> (wait out quiet hours) -> deliverPush
//                       -> deliverEmail -> finishDelivery
//
// The alert row fixes who it is for. Everything else (their settings, devices,
// email, the shipment) is read afresh, scoped to that user, at the moment it is
// needed, so a change made while an alert waits is honoured and nothing
// personal has to be carried between steps.
import type { Db } from "@/lib/db/client";
import { getNotificationPrefs } from "@/lib/db/notification-settings";
import {
  finishNotification,
  hasNewerNotification,
  loadNotification,
  type NotificationRef,
} from "@/lib/db/notify-sync";
import {
  listPushSubscriptions,
  markPushSuccess,
  removePushSubscriptionById,
} from "@/lib/db/push-subscriptions";
import { getLastCheckpoint, getShipment } from "@/lib/db/shipments";
import { getUserEmail } from "@/lib/db/users";
import { buildMessage, type BuiltMessage } from "./message";
import { channelsFor, type Channel } from "./prefs";
import { quietHoursEnd } from "./quiet-hours";
import { SendError, type EmailSender, type PushSender } from "./senders";

/** An alert older than this is no longer news. */
export const STALE_AFTER_MS = 24 * 60 * 60 * 1000;
/** The sweep re-queues alerts still pending after this long. */
export const SWEEP_AFTER_MS = 10 * 60 * 1000;

export type SkipReason =
  | "missing"
  | "not_pending"
  | "shipment_gone"
  | "stale"
  | "superseded"
  | "channels_off"
  | "no_destination";

export type Prepared =
  | { outcome: "skipped"; reason: SkipReason }
  | {
      outcome: "ready";
      /** Channels to try: switched on for this kind, and with somewhere to go. */
      channels: Channel[];
      /** ISO time when quiet hours end, or null to send now. */
      quietUntil: string | null;
    };

/**
 * Decides what to do with a pending alert right now. Alerts that should not go
 * out are marked skipped with the reason (a repeat run changes nothing).
 */
export async function prepareNotification(args: {
  db: Db;
  id: string;
  now: Date;
}): Promise<Prepared> {
  const { db, id, now } = args;

  const notification = await loadNotification(db, id);
  if (!notification) return { outcome: "skipped", reason: "missing" };
  // Already sent, skipped or failed: leave the first outcome alone.
  if (notification.status !== "pending") {
    return { outcome: "skipped", reason: "not_pending" };
  }

  const skip = async (reason: SkipReason): Promise<Prepared> => {
    await finishNotification(
      db,
      id,
      {
        status: "skipped",
        skipReason: reason,
        pushSent: false,
        emailSent: false,
      },
      now,
    );
    return { outcome: "skipped", reason };
  };

  const { userId } = notification;
  const shipment = await getShipment(db, userId, notification.shipmentId);
  if (!shipment || shipment.archivedAt) return skip("shipment_gone");
  if (now.getTime() - notification.createdAt.getTime() > STALE_AFTER_MS) {
    return skip("stale");
  }
  // An "out for delivery" held overnight is pointless once "delivered" exists.
  if (await hasNewerNotification(db, notification)) return skip("superseded");

  const prefs = await getNotificationPrefs(db, userId);
  const wanted = channelsFor(prefs, notification.kind);
  if (wanted.length === 0) return skip("channels_off");

  const channels: Channel[] = [];
  for (const channel of wanted) {
    if (channel === "push") {
      if ((await listPushSubscriptions(db, userId)).length > 0) {
        channels.push("push");
      }
    } else if (await getUserEmail(db, userId)) {
      channels.push("email");
    }
  }
  if (channels.length === 0) return skip("no_destination");

  const end = quietHoursEnd(now, prefs.quiet);
  return { outcome: "ready", channels, quietUntil: end?.toISOString() ?? null };
}

interface Loaded {
  notification: NotificationRef;
  message: BuiltMessage;
}

/** The alert and its words, or null if either is gone. */
async function loadForDelivery(
  db: Db,
  id: string,
  appUrl: string,
): Promise<Loaded | null> {
  const notification = await loadNotification(db, id);
  if (!notification) return null;
  const { userId, shipmentId } = notification;

  const shipment = await getShipment(db, userId, shipmentId);
  if (!shipment) return null;
  const lastCheckpoint = await getLastCheckpoint(db, userId, shipmentId);

  const message = buildMessage({
    kind: notification.kind,
    shipmentId,
    appUrl,
    subject: {
      nickname: shipment.nickname,
      trackingNumber: shipment.trackingNumber,
      status: shipment.status,
      eta: shipment.eta,
      lastCheckpoint,
    },
  });
  return { notification, message };
}

export interface PushDelivery {
  /** Devices tried. */
  attempted: number;
  sent: number;
  /** Devices the push service said no longer exist; their rows were deleted. */
  gone: number;
  /** Devices that refused for a reason retrying cannot fix. */
  failed: number;
}

/**
 * Sends the push to each of the user's devices. Throws a retryable SendError
 * only when nothing got through and something could still work later; if even
 * one device was reached, a retry would only buzz it again, so it is accepted.
 * (Alerts for a shipment share a tag, so a repeat replaces rather than stacks.)
 */
export async function deliverPush(args: {
  db: Db;
  sender: PushSender;
  id: string;
  appUrl: string;
  now: Date;
}): Promise<PushDelivery> {
  const { db, sender, id, appUrl, now } = args;
  const result: PushDelivery = { attempted: 0, sent: 0, gone: 0, failed: 0 };

  const loaded = await loadForDelivery(db, id, appUrl);
  if (!loaded) return result;
  const { userId } = loaded.notification;

  let retryable: SendError | null = null;
  for (const device of await listPushSubscriptions(db, userId)) {
    result.attempted += 1;
    try {
      const answer = await sender.send(
        { endpoint: device.endpoint, p256dh: device.p256dh, auth: device.auth },
        loaded.message.push,
      );
      if (answer === "gone") {
        result.gone += 1;
        await removePushSubscriptionById(db, userId, device.id);
      } else {
        result.sent += 1;
        await markPushSuccess(db, userId, device.id, now);
      }
    } catch (error) {
      if (!(error instanceof SendError)) throw error;
      if (error.retryable) retryable = error;
      else result.failed += 1;
    }
  }

  if (retryable && result.sent === 0) throw retryable;
  return result;
}

export interface EmailDelivery {
  attempted: number;
  sent: number;
  failed: number;
}

/**
 * Sends the email to the account's address. The alert's id is the idempotency
 * key, so a retry after a lost answer cannot send twice. Throws a retryable
 * SendError; a permanent refusal is a result.
 */
export async function deliverEmail(args: {
  db: Db;
  sender: EmailSender;
  id: string;
  appUrl: string;
}): Promise<EmailDelivery> {
  const { db, sender, id, appUrl } = args;
  const result: EmailDelivery = { attempted: 0, sent: 0, failed: 0 };

  const loaded = await loadForDelivery(db, id, appUrl);
  if (!loaded) return result;
  const to = await getUserEmail(db, loaded.notification.userId);
  if (!to) return result;

  result.attempted = 1;
  try {
    await sender.send({
      to,
      idempotencyKey: id,
      ...loaded.message.email,
    });
    result.sent = 1;
  } catch (error) {
    if (!(error instanceof SendError)) throw error;
    if (error.retryable) throw error;
    result.failed = 1;
  }
  return result;
}

/**
 * Records the outcome: sent if any channel got through; otherwise failed if a
 * channel refused for good; otherwise skipped (every device was gone).
 */
export async function finishDelivery(args: {
  db: Db;
  id: string;
  now: Date;
  push?: PushDelivery;
  email?: EmailDelivery;
}): Promise<"sent" | "skipped" | "failed"> {
  const { db, id, now, push, email } = args;
  const pushSent = (push?.sent ?? 0) > 0;
  const emailSent = (email?.sent ?? 0) > 0;
  const refused = (push?.failed ?? 0) + (email?.failed ?? 0) > 0;

  const status =
    pushSent || emailSent ? "sent" : refused ? "failed" : "skipped";
  await finishNotification(
    db,
    id,
    {
      status,
      skipReason: status === "skipped" ? "no_destination" : undefined,
      pushSent,
      emailSent,
    },
    now,
  );
  return status;
}
