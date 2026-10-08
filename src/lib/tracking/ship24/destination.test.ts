import { describe, expect, it } from "vitest";
import { ship24Destination } from "./destination";
import type { Ship24Tracking } from "./schemas";

const shipment = (
  extra: Partial<Ship24Tracking["shipment"]>,
): Ship24Tracking["shipment"] => ({
  statusCode: null,
  statusMilestone: "in_transit",
  ...extra,
});

describe("ship24Destination", () => {
  const cases: [string, Partial<Ship24Tracking["shipment"]>, string | null][] =
    [
      [
        "all parts, in order",
        {
          recipient: {
            city: "SAN RAFAEL",
            subdivision: "CA",
            postCode: "94901",
          },
          destinationCountryCode: "US",
        },
        "SAN RAFAEL, CA, 94901, US",
      ],
      [
        "skips missing parts",
        {
          recipient: {
            city: "LONDON",
            subdivision: null,
            postCode: "SW1A 1AA",
          },
          destinationCountryCode: "GB",
        },
        "LONDON, SW1A 1AA, GB",
      ],
      ["country only", { destinationCountryCode: "US" }, "US"],
      [
        "postcode and country only",
        { recipient: { postCode: "94901" }, destinationCountryCode: "US" },
        "94901, US",
      ],
      [
        "trims whitespace and drops blanks",
        {
          recipient: { city: "  OAKLAND ", subdivision: "   ", postCode: "" },
          destinationCountryCode: " US ",
        },
        "OAKLAND, US",
      ],
      ["nothing known", {}, null],
      [
        "an empty recipient and no country",
        { recipient: { city: null, subdivision: null, postCode: null } },
        null,
      ],
    ];

  it.each(cases)("%s", (_name, extra, expected) => {
    expect(ship24Destination(shipment(extra))).toBe(expected);
  });
});
