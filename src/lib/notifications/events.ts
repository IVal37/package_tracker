import { z } from "zod";

/** Sent when an alert has been recorded and is ready to be delivered. */
export const NOTIFICATION_CREATED = "wayfind/notification.created";

export const notificationCreatedSchema = z.object({
  notificationId: z.uuid(),
});

export type NotificationCreatedData = z.infer<typeof notificationCreatedSchema>;

const HOUR_MS = 3_600_000;

export interface NotificationEvent {
  /** Inngest drops a second event with the same id, so a repeat send is harmless. */
  id: string;
  name: typeof NOTIFICATION_CREATED;
  data: NotificationCreatedData;
}

/** One event per alert, sent right after the alert is recorded. */
export function buildNotificationEvents(
  notificationIds: readonly string[],
): NotificationEvent[] {
  return notificationIds.map((notificationId) => ({
    id: `notification-${notificationId}`,
    name: NOTIFICATION_CREATED,
    data: { notificationId },
  }));
}

/**
 * Events for the hourly sweep, which re-queues alerts whose first event never
 * ran. The hour in the id lets the sweep retry without flooding.
 */
export function buildSweepEvents(
  notificationIds: readonly string[],
  now: Date,
): NotificationEvent[] {
  const bucket = Math.floor(now.getTime() / HOUR_MS);
  return notificationIds.map((notificationId) => ({
    id: `notification-${notificationId}-sweep-${bucket}`,
    name: NOTIFICATION_CREATED,
    data: { notificationId },
  }));
}
