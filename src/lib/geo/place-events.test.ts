import { describe, expect, it } from "vitest";
import {
  GEOCODE_REQUESTED,
  PLACE_GEOCODE,
  buildPlaceEvents,
  placeEventId,
  placeEventSchema,
} from "./place-events";

describe("buildPlaceEvents", () => {
  it("makes one geocode event per pending place", () => {
    const events = buildPlaceEvents([
      { key: "memphis, tn", text: "MEMPHIS, TN" },
      { key: "chicago, il", text: "Chicago, IL" },
    ]);

    expect(events).toEqual([
      {
        id: placeEventId("memphis, tn"),
        name: PLACE_GEOCODE,
        data: { key: "memphis, tn", text: "MEMPHIS, TN" },
      },
      {
        id: placeEventId("chicago, il"),
        name: PLACE_GEOCODE,
        data: { key: "chicago, il", text: "Chicago, IL" },
      },
    ]);
  });

  it("returns nothing for nothing", () => {
    expect(buildPlaceEvents([])).toEqual([]);
  });

  it("gives the same place the same id every time, and different places different ids", () => {
    expect(placeEventId("memphis, tn")).toBe(placeEventId("memphis, tn"));
    expect(placeEventId("memphis, tn")).not.toBe(placeEventId("chicago, il"));
    expect(placeEventId("memphis, tn")).toMatch(/^place-[0-9a-f]{40}$/);
  });

  it("uses the documented event names", () => {
    expect(GEOCODE_REQUESTED).toBe("wayfind/geocode.requested");
    expect(PLACE_GEOCODE).toBe("wayfind/place.geocode");
  });
});

describe("placeEventSchema", () => {
  it("accepts key and text", () => {
    expect(placeEventSchema.safeParse({ key: "a", text: "A" }).success).toBe(
      true,
    );
  });

  it.each([{}, { key: "a" }, { text: "A" }, { key: "", text: "A" }, null])(
    "rejects %j",
    (value) => {
      expect(placeEventSchema.safeParse(value).success).toBe(false);
    },
  );
});
