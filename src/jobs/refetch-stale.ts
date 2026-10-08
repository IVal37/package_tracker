import { getDb } from "@/lib/db/client";
import { GEOCODE_REQUESTED } from "@/lib/geo/place-events";
import { refetchStaleShipments } from "@/lib/shipments/sync/refetch-stale";
import { getTrackingProvider } from "@/lib/tracking";
import { inngest } from "./client";

const MAX_TRACKERS_PER_RUN = 100;

/** Hourly safety net for webhooks that never arrived. */
export const refetchStale = inngest.createFunction(
  {
    id: "refetch-stale-shipments",
    triggers: { cron: "0 * * * *" },
    concurrency: 1,
  },
  async ({ step }) => {
    const result = await step.run("refetch", () =>
      refetchStaleShipments({
        db: getDb(),
        provider: getTrackingProvider(),
        now: new Date(),
        limit: MAX_TRACKERS_PER_RUN,
      }),
    );

    // New checkpoints may mention places that still need coordinates.
    if (result.updated > 0) {
      await step.sendEvent("request-geocoding", { name: GEOCODE_REQUESTED });
    }
    return result;
  },
);
