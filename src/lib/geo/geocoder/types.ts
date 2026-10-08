export interface GeocodeResult {
  lat: number;
  lng: number;
  displayName: string | null;
}

export interface Geocoder {
  /** Stored in places.geocoder so each cached row records who answered. */
  readonly name: "nominatim" | "fake";
  /**
   * Looks up free-text place ("MEMPHIS, TN"). Null means the service answered
   * and found nothing. Throws GeocoderError when it could not answer.
   */
  geocode(query: string): Promise<GeocodeResult | null>;
}

/** The geocoder could not answer. `retryable` errors are worth trying again. */
export class GeocoderError extends Error {
  readonly retryable: boolean;

  constructor(message: string, options: { retryable: boolean }) {
    super(message);
    this.name = "GeocoderError";
    this.retryable = options.retryable;
  }
}
