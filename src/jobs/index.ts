import { archiveDelivered } from "./archive-delivered";
import { geocodePlaceJob, geocodeSweep } from "./geocode";
import { emailCleanup, emailSweep, processEmailJob } from "./inbound-email";
import {
  notificationsCleanup,
  notificationsSweep,
  sendNotificationJob,
} from "./notifications";
import { refetchStale } from "./refetch-stale";

export { inngest } from "./client";
export const functions = [
  refetchStale,
  archiveDelivered,
  geocodeSweep,
  geocodePlaceJob,
  processEmailJob,
  emailSweep,
  emailCleanup,
  sendNotificationJob,
  notificationsSweep,
  notificationsCleanup,
];
