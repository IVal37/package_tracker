import { NonRetriableError } from "inngest";
import { getDb } from "@/lib/db/client";
import { getEnv } from "@/lib/env";
import {
  NOTIFICATION_CREATED,
  buildNotificationEvents,
  buildSweepEvents,
  notificationCreatedSchema,
} from "@/lib/notifications/events";
import {
  cleanupNotifications,
  sweepNotifications,
} from "@/lib/notifications/maintenance";
import {
  deliverEmail,
  deliverPush,
  finishDelivery,
  prepareNotification,
  type EmailDelivery,
  type Prepared,
  type PushDelivery,
} from "@/lib/notifications/send";
import {
  SendError,
  getEmailSender,
  getPushSender,
} from "@/lib/notifications/senders";
import { inngest } from "./client";

const MAX_PER_SWEEP = 200;
/** Quiet hours are waited out at most this many times (settings can change meanwhile). */
const MAX_QUIET_WAITS = 2;
const RETRIES = 4;

/**
 * Delivers one recorded alert by push and email, honouring the user's settings
 * and quiet hours. Push and email are separate steps, so retrying a failed
 * email never sends the push again.
 */
export const sendNotificationJob = inngest.createFunction(
  {
    id: "send-notification",
    triggers: { event: NOTIFICATION_CREATED },
    // An alert is only ever worked on by one run at a time.
    concurrency: { limit: 1, key: "event.data.notificationId" },
    retries: RETRIES,
  },
  async ({ event, step, attempt, maxAttempts }) => {
    const data = notificationCreatedSchema.safeParse(event.data);
    if (!data.success)
      throw new NonRetriableError("Invalid notification event");
    const { notificationId: id } = data.data;
    const db = getDb();
    const appUrl = getEnv().APP_URL;
    const lastAttempt = attempt >= (maxAttempts ?? RETRIES + 1) - 1;

    // Decide, and if it is quiet hours, sleep until they end and decide again.
    let prepared: Prepared | undefined;
    for (let round = 1; round <= MAX_QUIET_WAITS + 1; round++) {
      prepared = await step.run(`prepare-${round}`, () =>
        prepareNotification({ db, id, now: new Date() }),
      );
      if (prepared.outcome === "skipped") {
        return { outcome: "skipped", reason: prepared.reason };
      }
      // Still quiet after the last wait: send rather than hold it for ever.
      if (!prepared.quietUntil || round > MAX_QUIET_WAITS) break;
      await step.sleepUntil(`quiet-hours-${round}`, prepared.quietUntil);
    }
    if (!prepared || prepared.outcome !== "ready") {
      return { outcome: "skipped", reason: "not_ready" };
    }

    // A retryable failure retries the step; out of retries it is a failed channel.
    const push: PushDelivery | undefined = prepared.channels.includes("push")
      ? await step.run("push", async (): Promise<PushDelivery> => {
          try {
            return await deliverPush({
              db,
              sender: getPushSender(),
              id,
              appUrl,
              now: new Date(),
            });
          } catch (error) {
            if (error instanceof SendError && lastAttempt) {
              return { attempted: 1, sent: 0, gone: 0, failed: 1 };
            }
            throw error;
          }
        })
      : undefined;

    const email: EmailDelivery | undefined = prepared.channels.includes("email")
      ? await step.run("email", async (): Promise<EmailDelivery> => {
          try {
            return await deliverEmail({
              db,
              sender: getEmailSender(),
              id,
              appUrl,
            });
          } catch (error) {
            if (error instanceof SendError && lastAttempt) {
              return { attempted: 1, sent: 0, failed: 1 };
            }
            throw error;
          }
        })
      : undefined;

    const outcome = await step.run("finish", () =>
      finishDelivery({ db, id, now: new Date(), push, email }),
    );
    // Counts only: never the address, endpoint or message.
    console.info("notification", {
      outcome,
      push: push?.sent ?? 0,
      email: email?.sent ?? 0,
    });
    return { outcome, push, email };
  },
);

/**
 * Hourly: records delay alerts for ETAs that passed more than a day ago, and
 * re-queues alerts whose delivery event never ran.
 */
export const notificationsSweep = inngest.createFunction(
  {
    id: "notifications-sweep",
    triggers: { cron: "25 * * * *" },
    concurrency: 1,
  },
  async ({ step }) => {
    const { fresh, retry } = await step.run("sweep", () =>
      sweepNotifications({
        db: getDb(),
        now: new Date(),
        limit: MAX_PER_SWEEP,
      }),
    );

    if (fresh.length > 0) {
      await step.sendEvent("queue-new", buildNotificationEvents(fresh));
    }
    if (retry.length > 0) {
      await step.sendEvent("queue-retry", buildSweepEvents(retry, new Date()));
    }
    return { recorded: fresh.length, requeued: retry.length };
  },
);

/** Daily: deletes alerts older than 90 days. */
export const notificationsCleanup = inngest.createFunction(
  {
    id: "notifications-cleanup",
    triggers: { cron: "TZ=UTC 50 3 * * *" },
    concurrency: 1,
  },
  async ({ step }) =>
    step.run("cleanup", () =>
      cleanupNotifications({ db: getDb(), now: new Date() }),
    ),
);
