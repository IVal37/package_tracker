import type { Db } from "@/lib/db/client";
import { hasPlace, savePlace } from "@/lib/db/geo-sync";
import type { Geocoder } from "./geocoder";

export type GeocodePlaceOutcome = "cached" | "found" | "missing";

/**
 * Makes sure one place is in the cache, asking the geocoder only if it is not.
 * A cached hit and a cached miss both return without any network call; a new
 * answer, including "nothing found", is stored so it is never asked again.
 * A GeocoderError (the service could not answer) propagates and stores nothing,
 * so the job retries instead of caching a failure as a miss.
 */
export async function geocodePlace(args: {
  db: Db;
  geocoder: Geocoder;
  key: string;
  text: string;
}): Promise<GeocodePlaceOutcome> {
  const { db, geocoder, key, text } = args;

  if (await hasPlace(db, key)) return "cached";

  const result = await geocoder.geocode(text);
  await savePlace(db, key, result, geocoder.name);
  return result ? "found" : "missing";
}
