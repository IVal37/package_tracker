import type { Geocoder, GeocodeResult } from "./types";

// Every place the fake tracking scenarios mention, so local development shows
// a full map without any network. Anything else is "not found".
const PLACES: Record<string, GeocodeResult> = {
  "chicago, il": { lat: 41.8781, lng: -87.6298, displayName: "Chicago, IL" },
  "memphis, tn": { lat: 35.1495, lng: -90.049, displayName: "Memphis, TN" },
  "san francisco, ca": {
    lat: 37.7749,
    lng: -122.4194,
    displayName: "San Francisco, CA",
  },
  "oakland, ca": { lat: 37.8044, lng: -122.2712, displayName: "Oakland, CA" },
  "denver, co": { lat: 39.7392, lng: -104.9903, displayName: "Denver, CO" },
  "los angeles, ca": {
    lat: 34.0522,
    lng: -118.2437,
    displayName: "Los Angeles, CA",
  },
  "los angeles international airport, ca": {
    lat: 33.9416,
    lng: -118.4085,
    displayName: "Los Angeles International Airport, CA",
  },
  "shenzhen baoan international airport, cn": {
    lat: 22.6393,
    lng: 113.8107,
    displayName: "Shenzhen Bao'an International Airport, CN",
  },
  "san francisco, ca, us": {
    lat: 37.7749,
    lng: -122.4194,
    displayName: "San Francisco, CA, US",
  },
  "denver, co, us": {
    lat: 39.7392,
    lng: -104.9903,
    displayName: "Denver, CO, US",
  },
  "portland, or, us": {
    lat: 45.5152,
    lng: -122.6784,
    displayName: "Portland, OR, US",
  },
  "san diego, ca, us": {
    lat: 32.7157,
    lng: -117.1611,
    displayName: "San Diego, CA, US",
  },
};

/** Canned coordinates for development and tests. Never touches the network. */
export class FakeGeocoder implements Geocoder {
  readonly name = "fake";

  async geocode(query: string): Promise<GeocodeResult | null> {
    const key = query.trim().toLowerCase().replace(/\s+/g, " ");
    return PLACES[key] ?? null;
  }
}
