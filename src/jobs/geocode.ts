import { NonRetriableError } from "inngest";
import { getDb } from "@/lib/db/client";
import { findPendingPlaces } from "@/lib/db/geo-sync";
import { GeocoderError, getGeocoder } from "@/lib/geo/geocoder";
import { geocodePlace } from "@/lib/geo/geocode-place";
import {
  GEOCODE_REQUESTED,
  PLACE_GEOCODE,
  buildPlaceEvents,
  placeEventSchema,
} from "@/lib/geo/place-events";
import { inngest } from "./client";

const MAX_PLACES_PER_SWEEP = 200;

/**
 * Finds places that have no cached coordinates and queues one geocode event for
 * each. Runs when something new arrives (wayfind/geocode.requested) and hourly
 * as a backstop for requests that were never sent.
 */
export const geocodeSweep = inngest.createFunction(
  {
    id: "geocode-sweep",
    triggers: [{ event: GEOCODE_REQUESTED }, { cron: "15 * * * *" }],
    concurrency: 1,
  },
  async ({ step }) => {
    const pending = await step.run("find-pending", () =>
      findPendingPlaces(getDb(), MAX_PLACES_PER_SWEEP),
    );
    if (pending.length === 0) return { queued: 0 };

    await step.sendEvent("queue-places", buildPlaceEvents(pending));
    return { queued: pending.length };
  },
);

/**
 * Geocodes one place. Throttled to one run a second, which keeps the whole app
 * inside Nominatim's usage policy however many places are queued.
 */
export const geocodePlaceJob = inngest.createFunction(
  {
    id: "geocode-place",
    triggers: { event: PLACE_GEOCODE },
    throttle: { limit: 1, period: "1s" },
    retries: 3,
  },
  async ({ event, step }) => {
    const data = placeEventSchema.safeParse(event.data);
    if (!data.success) throw new NonRetriableError("Invalid place event");

    return step.run("geocode", async () => {
      try {
        const outcome = await geocodePlace({
          db: getDb(),
          geocoder: getGeocoder(),
          key: data.data.key,
          text: data.data.text,
        });
        return { outcome };
      } catch (error) {
        // A permanent geocoder error (bad request, bad response) won't improve
        // on retry. Everything else, including outages, is retried.
        if (error instanceof GeocoderError && !error.retryable) {
          throw new NonRetriableError(error.message);
        }
        throw error;
      }
    });
  },
);
