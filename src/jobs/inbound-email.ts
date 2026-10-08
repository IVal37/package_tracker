import { NonRetriableError } from "inngest";
import { getDb } from "@/lib/db/client";
import { cleanupInboundData, findStuckEmailIds } from "@/lib/email/cleanup";
import {
  EMAIL_RECEIVED,
  buildEmailEvents,
  emailReceivedSchema,
} from "@/lib/email/events";
import { getExtractor } from "@/lib/email/extract";
import {
  ProcessingRetryError,
  markInboundEmailFailed,
  processInboundEmail,
  type ProcessResult,
} from "@/lib/email/process";
import { GEOCODE_REQUESTED } from "@/lib/geo/place-events";
import { getTrackingProvider } from "@/lib/tracking";
import { inngest } from "./client";

const MAX_SWEPT_PER_RUN = 100;

/** Reads one stored email: extracts it, then creates the order or shipments. */
export const processEmailJob = inngest.createFunction(
  {
    id: "process-inbound-email",
    triggers: { event: EMAIL_RECEIVED },
    // An email is only ever worked on by one run at a time.
    concurrency: { limit: 1, key: "event.data.emailId" },
    retries: 3,
  },
  async ({ event, step, attempt, maxAttempts }) => {
    const data = emailReceivedSchema.safeParse(event.data);
    if (!data.success) throw new NonRetriableError("Invalid email event");
    const { emailId } = data.data;

    const outcome = await step.run(
      "process",
      async (): Promise<ProcessResult> => {
        try {
          return await processInboundEmail({
            db: getDb(),
            provider: getTrackingProvider(),
            extractor: getExtractor(),
            emailId,
          });
        } catch (error) {
          const lastAttempt = attempt >= (maxAttempts ?? 4) - 1;
          if (error instanceof ProcessingRetryError && lastAttempt) {
            // Out of retries: stop leaving the email pending.
            await markInboundEmailFailed(getDb(), emailId, error.message);
            return { status: "failed", created: 0 };
          }
          throw error;
        }
      },
    );

    // New packages may mention places that still need coordinates.
    if (outcome.created > 0) {
      await step.sendEvent("request-geocoding", { name: GEOCODE_REQUESTED });
    }
    return outcome;
  },
);

/** Hourly backstop: re-queues emails whose processing event was never delivered. */
export const emailSweep = inngest.createFunction(
  {
    id: "inbound-email-sweep",
    triggers: { cron: "20 * * * *" },
    concurrency: 1,
  },
  async ({ step }) => {
    const ids = await step.run("find-stuck", () =>
      findStuckEmailIds({
        db: getDb(),
        now: new Date(),
        limit: MAX_SWEPT_PER_RUN,
      }),
    );
    if (ids.length === 0) return { queued: 0 };

    await step.sendEvent("queue-emails", buildEmailEvents(ids, new Date()));
    return { queued: ids.length };
  },
);

/** Daily: deletes raw emails after 30 days and placeholders that never shipped after 90. */
export const emailCleanup = inngest.createFunction(
  {
    id: "inbound-email-cleanup",
    triggers: { cron: "TZ=UTC 40 3 * * *" },
    concurrency: 1,
  },
  async ({ step }) =>
    step.run("cleanup", () =>
      cleanupInboundData({ db: getDb(), now: new Date() }),
    ),
);
