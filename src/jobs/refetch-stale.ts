import { NonRetriableError } from "inngest";
import { getDb } from "@/lib/db/client";
import { GEOCODE_REQUESTED } from "@/lib/geo/place-events";
import { buildNotificationEvents } from "@/lib/notifications/events";
import {
  TRACKER_REFETCH,
  buildRefetchEvents,
  findTrackersToRefetch,
  refetchTracker,
  trackerRefetchSchema,
} from "@/lib/shipments/sync/refetch-stale";
import { getTrackingProvider } from "@/lib/tracking";
import { inngest } from "./client";

const MAX_TRACKERS_PER_SWEEP = 500;
const HOUR_MS = 3_600_000;

/**
 * Hourly safety net for webhooks that never arrived: finds stale trackers and
 * queues one re-fetch event for each, so no single run holds many provider
 * calls.
 */
export const refetchStale = inngest.createFunction(
  {
    id: "refetch-stale-shipments",
    triggers: { cron: "0 * * * *" },
    concurrency: 1,
  },
  async ({ step }) => {
    const trackerIds = await step.run("find-stale", () =>
      findTrackersToRefetch({
        db: getDb(),
        provider: getTrackingProvider(),
        now: new Date(),
        limit: MAX_TRACKERS_PER_SWEEP,
      }),
    );
    if (trackerIds.length === 0) return { queued: 0 };

    await step.sendEvent(
      "queue-trackers",
      buildRefetchEvents(trackerIds, new Date()),
    );
    return { queued: trackerIds.length };
  },
);

/**
 * Re-fetches one tracker. Throttled well under the provider's rate limit, and
 * a few at a time, however many the sweep queued.
 */
export const refetchTrackerJob = inngest.createFunction(
  {
    id: "refetch-tracker",
    triggers: { event: TRACKER_REFETCH },
    concurrency: { limit: 5 },
    throttle: { limit: 2, period: "1s" },
    retries: 3,
  },
  async ({ event, step }) => {
    const data = trackerRefetchSchema.safeParse(event.data);
    if (!data.success) throw new NonRetriableError("Invalid refetch event");

    const result = await step.run("refetch", () =>
      refetchTracker({
        db: getDb(),
        provider: getTrackingProvider(),
        trackerId: data.data.trackerId,
        now: new Date(),
      }),
    );

    if (result.outcome === "updated") {
      // New checkpoints may mention places that still need coordinates. One
      // request per hour is enough for the whole sweep (the id de-duplicates).
      const bucket = Math.floor(Date.now() / HOUR_MS);
      await step.sendEvent("request-geocoding", {
        name: GEOCODE_REQUESTED,
        id: `geocode-after-refetch-${bucket}`,
      });
    }
    // Alerts recorded by the update are delivered by their own job.
    if (
      (result.outcome === "updated" || result.outcome === "unchanged") &&
      result.notificationIds.length > 0
    ) {
      await step.sendEvent(
        "request-notifications",
        buildNotificationEvents(result.notificationIds),
      );
    }
    return result;
  },
);
