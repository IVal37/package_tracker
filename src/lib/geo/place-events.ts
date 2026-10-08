import { createHash } from "node:crypto";
import { z } from "zod";
import type { PendingPlace } from "@/lib/db/geo-sync";

export const GEOCODE_REQUESTED = "wayfind/geocode.requested";
export const PLACE_GEOCODE = "wayfind/place.geocode";

/** Payload of a wayfind/place.geocode event. */
export const placeEventSchema = z.object({
  key: z.string().min(1),
  text: z.string().min(1),
});

export type PlaceEventData = z.infer<typeof placeEventSchema>;

export interface PlaceEvent {
  /** Stable per place, so Inngest de-duplicates a burst of sweeps for 24 hours. */
  id: string;
  name: typeof PLACE_GEOCODE;
  data: PlaceEventData;
}

export const placeEventId = (key: string) =>
  `place-${createHash("sha1").update(key).digest("hex")}`;

/** One geocode event per pending place. */
export function buildPlaceEvents(
  pending: readonly PendingPlace[],
): PlaceEvent[] {
  return pending.map(({ key, text }) => ({
    id: placeEventId(key),
    name: PLACE_GEOCODE,
    data: { key, text },
  }));
}
