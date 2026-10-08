// @vitest-environment node
import { eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { createTestDb } from "../../../tests/db/pglite";
import { places } from "@/lib/db/schema";
import { geocodePlace } from "./geocode-place";
import { GeocoderError, type Geocoder } from "./geocoder";

let ctx: Awaited<ReturnType<typeof createTestDb>>;

beforeAll(async () => {
  ctx = await createTestDb();
});

afterAll(async () => {
  await ctx.client.close();
});

const geocoderReturning = (
  result: Awaited<ReturnType<Geocoder["geocode"]>> | Error,
) => {
  const geocode = vi.fn(async () => {
    if (result instanceof Error) throw result;
    return result;
  });
  return { name: "fake" as const, geocode } satisfies Geocoder;
};

const rowFor = async (key: string) =>
  (await ctx.db.select().from(places).where(eq(places.queryKey, key)))[0];

describe("geocodePlace (cache-first)", () => {
  it("asks the geocoder for a new place and stores the hit", async () => {
    const geocoder = geocoderReturning({
      lat: 35.1,
      lng: -90,
      displayName: "Memphis",
    });

    const outcome = await geocodePlace({
      db: ctx.db,
      geocoder,
      key: "memphis, tn",
      text: "MEMPHIS, TN",
    });

    expect(outcome).toBe("found");
    expect(geocoder.geocode).toHaveBeenCalledExactlyOnceWith("MEMPHIS, TN");
    expect(await rowFor("memphis, tn")).toMatchObject({
      lat: 35.1,
      lng: -90,
      geocoder: "fake",
    });
  });

  it("makes no call at all for a cached hit", async () => {
    const geocoder = geocoderReturning({ lat: 1, lng: 1, displayName: null });

    const outcome = await geocodePlace({
      db: ctx.db,
      geocoder,
      key: "memphis, tn",
      text: "MEMPHIS, TN",
    });

    expect(outcome).toBe("cached");
    expect(geocoder.geocode).not.toHaveBeenCalled();
  });

  it("stores a remembered miss when nothing is found", async () => {
    const geocoder = geocoderReturning(null);

    const outcome = await geocodePlace({
      db: ctx.db,
      geocoder,
      key: "atlantis",
      text: "ATLANTIS",
    });

    expect(outcome).toBe("missing");
    const row = await rowFor("atlantis");
    expect(row).toBeDefined();
    expect(row?.lat).toBeNull();
  });

  it("makes no call for a cached miss", async () => {
    const geocoder = geocoderReturning({ lat: 1, lng: 1, displayName: null });

    const outcome = await geocodePlace({
      db: ctx.db,
      geocoder,
      key: "atlantis",
      text: "ATLANTIS",
    });

    expect(outcome).toBe("cached");
    expect(geocoder.geocode).not.toHaveBeenCalled();
  });

  it("stores nothing and rethrows when the geocoder cannot answer", async () => {
    const geocoder = geocoderReturning(
      new GeocoderError("429", { retryable: true }),
    );

    await expect(
      geocodePlace({
        db: ctx.db,
        geocoder,
        key: "flaky place",
        text: "FLAKY PLACE",
      }),
    ).rejects.toBeInstanceOf(GeocoderError);

    expect(await rowFor("flaky place")).toBeUndefined();
  });
});
