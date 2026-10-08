// The only entry point the rest of the app uses for geocoding. The adapters
// live in ./nominatim and ./fake and must not be imported from outside
// src/lib/geo (enforced by ESLint no-restricted-imports).
import { getEnv, type Env } from "@/lib/env";
import { FakeGeocoder } from "./fake";
import { NominatimGeocoder } from "./nominatim";
import type { Geocoder } from "./types";

export { GeocoderError, type Geocoder, type GeocodeResult } from "./types";

type GeocoderEnv = Pick<Env, "GEOCODER" | "APP_URL">;

/** Pure: builds the geocoder an env asks for. */
export function createGeocoder(env: GeocoderEnv): Geocoder {
  if (env.GEOCODER === "nominatim") {
    return new NominatimGeocoder({
      userAgent: `Wayfind/0.1 (+${env.APP_URL})`,
    });
  }
  return new FakeGeocoder();
}

let cached: Geocoder | undefined;

/** Lazy per-process singleton chosen by GEOCODER. */
export function getGeocoder(): Geocoder {
  cached ??= createGeocoder(getEnv());
  return cached;
}

/** Test helper: drop the cached geocoder. */
export function resetGeocoderCache(): void {
  cached = undefined;
}
