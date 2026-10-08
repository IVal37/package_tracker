// @vitest-environment node
import { InngestTestEngine } from "@inngest/test";
import { beforeEach, describe, expect, it, vi } from "vitest";

const { findPendingPlaces, geocodePlace, geocoder } = vi.hoisted(() => ({
  findPendingPlaces: vi.fn(),
  geocodePlace: vi.fn(),
  geocoder: { name: "fake" },
}));

vi.mock("@/lib/db/client", () => ({ getDb: () => "db" }));
vi.mock("@/lib/db/geo-sync", () => ({ findPendingPlaces }));
vi.mock("@/lib/geo/geocode-place", () => ({ geocodePlace }));
vi.mock("@/lib/geo/geocoder", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/geo/geocoder")>()),
  getGeocoder: () => geocoder,
}));

import { GeocoderError } from "@/lib/geo/geocoder";
import { geocodePlaceJob, geocodeSweep } from "./geocode";

beforeEach(() => {
  findPendingPlaces.mockReset();
  geocodePlace.mockReset();
});

describe("geocodeSweep", () => {
  it("is triggered by the request event and by an hourly cron", () => {
    expect(geocodeSweep.opts.triggers).toEqual([
      { event: "wayfind/geocode.requested" },
      { cron: "15 * * * *" },
    ]);
    expect(geocodeSweep.opts.concurrency).toBe(1);
  });

  it("queues one place event per pending place", async () => {
    findPendingPlaces.mockResolvedValue([
      { key: "memphis, tn", text: "MEMPHIS, TN" },
      { key: "chicago, il", text: "Chicago, IL" },
    ]);

    const { result, ctx } = await new InngestTestEngine({
      function: geocodeSweep,
    }).execute({
      steps: [{ id: "queue-places", handler: () => ({ ids: ["a", "b"] }) }],
    });

    expect(result).toEqual({ queued: 2 });
    expect(findPendingPlaces).toHaveBeenCalledWith("db", 200);
    expect(ctx.step.sendEvent).toHaveBeenCalledWith("queue-places", [
      expect.objectContaining({
        name: "wayfind/place.geocode",
        data: { key: "memphis, tn", text: "MEMPHIS, TN" },
        id: expect.stringMatching(/^place-/),
      }),
      expect.objectContaining({
        name: "wayfind/place.geocode",
        data: { key: "chicago, il", text: "Chicago, IL" },
      }),
    ]);
  });

  it("sends nothing when every place is already cached", async () => {
    findPendingPlaces.mockResolvedValue([]);

    const { result, ctx } = await new InngestTestEngine({
      function: geocodeSweep,
    }).execute();

    expect(result).toEqual({ queued: 0 });
    expect(ctx.step.sendEvent).not.toHaveBeenCalled();
  });
});

describe("geocodePlaceJob", () => {
  const run = (data: unknown) =>
    new InngestTestEngine({ function: geocodePlaceJob }).execute({
      events: [{ name: "wayfind/place.geocode", data: data as never }],
    });

  it("is event-triggered and throttled to one a second", () => {
    expect(geocodePlaceJob.opts.triggers).toEqual([
      { event: "wayfind/place.geocode" },
    ]);
    expect(geocodePlaceJob.opts.throttle).toEqual({ limit: 1, period: "1s" });
  });

  it("geocodes the place with the real db and geocoder", async () => {
    geocodePlace.mockResolvedValue("found");

    const { result } = await run({ key: "memphis, tn", text: "MEMPHIS, TN" });

    expect(result).toEqual({ outcome: "found" });
    expect(geocodePlace).toHaveBeenCalledExactlyOnceWith({
      db: "db",
      geocoder,
      key: "memphis, tn",
      text: "MEMPHIS, TN",
    });
  });

  it("refuses an event without the right data, without retrying", async () => {
    const { error } = await run({ nope: true });
    expect(error).toMatchObject({
      name: "NonRetriableError",
      message: "Invalid place event",
    });
    expect(geocodePlace).not.toHaveBeenCalled();
  });

  it("does not retry a permanent geocoder error", async () => {
    geocodePlace.mockRejectedValue(
      new GeocoderError("bad response", { retryable: false }),
    );
    const { error } = await run({ key: "k", text: "T" });
    expect(error).toBeDefined();
    expect(String((error as Error).name)).toContain("NonRetriableError");
  });

  it("lets a transient geocoder error through so Inngest retries", async () => {
    geocodePlace.mockRejectedValue(
      new GeocoderError("429", { retryable: true }),
    );
    const { error } = await run({ key: "k", text: "T" });
    expect(error).toBeDefined();
    expect(String((error as Error).name)).not.toContain("NonRetriableError");
  });
});
