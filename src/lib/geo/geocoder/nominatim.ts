import { z } from "zod";
import { GeocoderError, type GeocodeResult, type Geocoder } from "./types";

export interface NominatimConfig {
  /** Identifies this app, as Nominatim's usage policy requires. */
  userAgent: string;
  baseUrl?: string;
  fetch?: typeof fetch;
}

const DEFAULT_BASE_URL = "https://nominatim.openstreetmap.org";

// Nominatim returns coordinates as strings.
const responseSchema = z.array(
  z.object({
    lat: z.string(),
    lon: z.string(),
    display_name: z.string().optional(),
  }),
);

/**
 * OpenStreetMap's public geocoder. Policy: at most one request a second (the
 * geocode-place job is throttled to that), an identifying User-Agent, and
 * results are expected to be cached (they are, in `places`).
 */
export class NominatimGeocoder implements Geocoder {
  readonly name = "nominatim";
  private readonly baseUrl: string;

  constructor(private readonly config: NominatimConfig) {
    this.baseUrl = config.baseUrl ?? DEFAULT_BASE_URL;
  }

  async geocode(query: string): Promise<GeocodeResult | null> {
    const url = new URL("/search", this.baseUrl);
    url.searchParams.set("q", query);
    url.searchParams.set("format", "jsonv2");
    url.searchParams.set("limit", "1");

    // Looked up per call, not captured at construction: tests (and anything
    // else that wraps global fetch) install their fetch after modules load.
    const doFetch = this.config.fetch ?? fetch;

    let response: Response;
    try {
      response = await doFetch(url, {
        headers: {
          "User-Agent": this.config.userAgent,
          Accept: "application/json",
        },
      });
    } catch {
      throw new GeocoderError("Nominatim request failed", { retryable: true });
    }

    if (response.status === 429 || response.status >= 500) {
      throw new GeocoderError(`Nominatim responded ${response.status}`, {
        retryable: true,
      });
    }
    if (!response.ok) {
      throw new GeocoderError(`Nominatim responded ${response.status}`, {
        retryable: false,
      });
    }

    let body: unknown;
    try {
      body = await response.json();
    } catch {
      throw new GeocoderError("Nominatim returned invalid JSON", {
        retryable: false,
      });
    }
    const parsed = responseSchema.safeParse(body);
    if (!parsed.success) {
      throw new GeocoderError("Nominatim response failed validation", {
        retryable: false,
      });
    }

    const [first] = parsed.data;
    if (!first) return null;

    const lat = Number(first.lat);
    const lng = Number(first.lon);
    if (
      !Number.isFinite(lat) ||
      !Number.isFinite(lng) ||
      Math.abs(lat) > 90 ||
      Math.abs(lng) > 180
    ) {
      throw new GeocoderError("Nominatim returned invalid coordinates", {
        retryable: false,
      });
    }
    return { lat, lng, displayName: first.display_name ?? null };
  }
}
