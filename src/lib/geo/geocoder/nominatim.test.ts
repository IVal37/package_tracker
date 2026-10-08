// @vitest-environment node
import { http, HttpResponse } from "msw";
import { describe, expect, it } from "vitest";
import empty from "../../../../tests/fixtures/nominatim/empty.json";
import hit from "../../../../tests/fixtures/nominatim/hit.json";
import malformed from "../../../../tests/fixtures/nominatim/malformed.json";
import { server } from "../../../../tests/msw/server";
import { NominatimGeocoder } from "./nominatim";
import { GeocoderError } from "./types";

const SEARCH = "https://nominatim.openstreetmap.org/search";
const USER_AGENT = "Wayfind/0.1 (+https://wayfind.example.test)";
const geocoder = new NominatimGeocoder({ userAgent: USER_AGENT });

const failure = async (promise: Promise<unknown>) => {
  try {
    await promise;
  } catch (error) {
    return error;
  }
  throw new Error("expected a rejection");
};

describe("NominatimGeocoder", () => {
  it("turns a hit into numeric coordinates and a display name", async () => {
    server.use(http.get(SEARCH, () => HttpResponse.json(hit)));

    const result = await geocoder.geocode("MEMPHIS, TN");

    expect(result).toEqual({
      lat: 35.1460249,
      lng: -90.0517638,
      displayName: "Memphis, Shelby County, Tennessee, United States",
    });
    expect(typeof result?.lat).toBe("number");
  });

  it("sends the query, json format, a single result and the identifying User-Agent", async () => {
    let url: URL | undefined;
    let userAgent: string | null = null;
    server.use(
      http.get(SEARCH, ({ request }) => {
        url = new URL(request.url);
        userAgent = request.headers.get("user-agent");
        return HttpResponse.json(hit);
      }),
    );

    await geocoder.geocode("SAN RAFAEL, CA 94901 & more");

    expect(url?.searchParams.get("q")).toBe("SAN RAFAEL, CA 94901 & more");
    expect(url?.searchParams.get("format")).toBe("jsonv2");
    expect(url?.searchParams.get("limit")).toBe("1");
    expect(userAgent).toBe(USER_AGENT);
  });

  it("returns null when nothing matches", async () => {
    server.use(http.get(SEARCH, () => HttpResponse.json(empty)));
    expect(await geocoder.geocode("NOWHERE LAND")).toBeNull();
  });

  it("has a null display name when Nominatim sends none", async () => {
    server.use(
      http.get(SEARCH, () => HttpResponse.json([{ lat: "1.5", lon: "2.5" }])),
    );
    expect(await geocoder.geocode("X")).toEqual({
      lat: 1.5,
      lng: 2.5,
      displayName: null,
    });
  });

  it.each([429, 500, 502, 503])(
    "throws a retryable error for HTTP %i",
    async (status) => {
      server.use(http.get(SEARCH, () => new HttpResponse(null, { status })));
      const error = await failure(geocoder.geocode("X"));
      expect(error).toBeInstanceOf(GeocoderError);
      expect((error as GeocoderError).retryable).toBe(true);
    },
  );

  it.each([400, 403, 404])(
    "throws a non-retryable error for HTTP %i",
    async (status) => {
      server.use(http.get(SEARCH, () => new HttpResponse(null, { status })));
      const error = await failure(geocoder.geocode("X"));
      expect(error).toBeInstanceOf(GeocoderError);
      expect((error as GeocoderError).retryable).toBe(false);
    },
  );

  it("throws a retryable error when the network fails", async () => {
    server.use(http.get(SEARCH, () => HttpResponse.error()));
    const error = await failure(geocoder.geocode("X"));
    expect(error).toBeInstanceOf(GeocoderError);
    expect((error as GeocoderError).retryable).toBe(true);
  });

  it("rejects a response with the wrong shape", async () => {
    server.use(http.get(SEARCH, () => HttpResponse.json(malformed)));
    const error = await failure(geocoder.geocode("X"));
    expect(error).toBeInstanceOf(GeocoderError);
    expect((error as GeocoderError).retryable).toBe(false);
  });

  it("rejects a body that is not JSON", async () => {
    server.use(
      http.get(SEARCH, () => new HttpResponse("<html>", { status: 200 })),
    );
    const error = await failure(geocoder.geocode("X"));
    expect((error as GeocoderError).retryable).toBe(false);
  });

  it.each([
    ["not a number", { lat: "abc", lon: "1" }],
    ["latitude out of range", { lat: "91", lon: "1" }],
    ["longitude out of range", { lat: "1", lon: "181" }],
  ])("rejects invalid coordinates: %s", async (_name, row) => {
    server.use(http.get(SEARCH, () => HttpResponse.json([row])));
    const error = await failure(geocoder.geocode("X"));
    expect(error).toBeInstanceOf(GeocoderError);
    expect((error as GeocoderError).retryable).toBe(false);
  });

  it("can use a different base URL", async () => {
    server.use(
      http.get("https://geocode.internal.test/search", () =>
        HttpResponse.json(hit),
      ),
    );
    const custom = new NominatimGeocoder({
      userAgent: USER_AGENT,
      baseUrl: "https://geocode.internal.test",
    });
    expect(await custom.geocode("MEMPHIS")).not.toBeNull();
  });
});
