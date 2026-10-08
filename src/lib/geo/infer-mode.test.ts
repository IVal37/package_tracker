import { describe, expect, it } from "vitest";
import type { Mode, Status } from "@/lib/tracking";
import type { LatLng } from "./distance";
import {
  AIR_HOP_KM,
  inferMode,
  shipmentMode,
  type ModeCheckpoint,
} from "./infer-mode";

const T0 = new Date("2026-06-01T00:00:00Z");
const hoursAfter = (hours: number) =>
  new Date(T0.getTime() + hours * 3_600_000);

const KM_PER_DEGREE = (2 * Math.PI * 6371) / 360;
/** A point `km` north of the equator on the prime meridian. */
const northOf = (km: number): LatLng => ({ lat: km / KM_PER_DEGREE, lng: 0 });
const ORIGIN = northOf(0);

const checkpoint = (
  status: Status,
  message: string | null,
  locationText: string | null,
  extra: Partial<ModeCheckpoint> = {},
): ModeCheckpoint => ({
  status,
  message,
  locationText,
  occurredAt: T0,
  point: null,
  ...extra,
});

describe("inferMode: status and wording", () => {
  const cases: [string, Status, string | null, string | null, Mode][] = [
    // van: a local vehicle is moving
    [
      "out for delivery",
      "OutForDelivery",
      "Out for delivery",
      "SAN FRANCISCO, CA",
      "van",
    ],
    [
      "failed attempt",
      "AttemptFail",
      "Delivery attempted - no access",
      "OAKLAND, CA",
      "van",
    ],
    [
      "out for delivery beats airport wording",
      "OutForDelivery",
      "Out for delivery",
      "SFO AIRPORT, CA",
      "van",
    ],

    // pin: not moving
    ["pending", "Pending", null, null, "pin"],
    ["info received", "InfoReceived", "Shipping label created", null, "pin"],
    [
      "delivered",
      "Delivered",
      "Delivered, left at front door",
      "SAN FRANCISCO, CA",
      "pin",
    ],
    [
      "ready for pickup",
      "AvailableForPickup",
      "Ready for pickup",
      "OAKLAND, CA",
      "pin",
    ],
    [
      "exception",
      "Exception",
      "Delivery exception: address issue",
      "DENVER, CO",
      "pin",
    ],
    ["expired", "Expired", null, null, "pin"],
    [
      "delivered at an airport-named place",
      "Delivered",
      "Delivered",
      "AIRPORT ROAD, TX",
      "pin",
    ],

    // plane: air wording
    [
      "departed origin airport",
      "InTransit",
      "Departed origin airport",
      "SHENZHEN BAOAN INTERNATIONAL AIRPORT, CN",
      "plane",
    ],
    [
      "arrived at air gateway",
      "InTransit",
      "Arrived at air gateway",
      "LOS ANGELES, CA",
      "plane",
    ],
    [
      "air hub",
      "InTransit",
      "Processed through air hub",
      "MEMPHIS, TN",
      "plane",
    ],
    ["flight departed", "InTransit", "Flight departed", null, "plane"],
    ["loaded on aircraft", "InTransit", "Loaded on aircraft", null, "plane"],
    [
      "air freight",
      "InTransit",
      "Air freight received at destination",
      "CINCINNATI, OH",
      "plane",
    ],
    ["air cargo", "InTransit", "Air cargo handover", null, "plane"],
    ["shipped by air", "InTransit", "Shipped by air", null, "plane"],
    [
      "airline handover",
      "InTransit",
      "Handed to airline",
      "FRANKFURT, DE",
      "plane",
    ],
    [
      "air terminal, uppercase",
      "InTransit",
      "DEPARTED AIR TERMINAL",
      "HONG KONG",
      "plane",
    ],
    [
      "airport only in the location",
      "InTransit",
      "Arrived",
      "LOUISVILLE INTERNATIONAL AIRPORT, KY",
      "plane",
    ],

    // ship: sea wording
    ["vessel departed", "InTransit", "Vessel departed", "SHANGHAI, CN", "ship"],
    ["port of origin", "InTransit", "Loaded at Port of Shanghai", null, "ship"],
    [
      "port of destination",
      "InTransit",
      "Arrived at Port of Los Angeles",
      "LOS ANGELES, CA",
      "ship",
    ],
    ["ocean freight", "InTransit", "Ocean freight in transit", null, "ship"],
    ["sea freight", "InTransit", "Sea freight departed origin", null, "ship"],
    ["container ship", "InTransit", "Container ship arrived", null, "ship"],
    ["maritime", "InTransit", "Maritime transit", null, "ship"],
    ["by sea", "InTransit", "Shipped by sea", null, "ship"],
    [
      "port terminal",
      "InTransit",
      "Port terminal handling",
      "ROTTERDAM, NL",
      "ship",
    ],
    ["seaport", "InTransit", "Arrived at seaport", null, "ship"],

    // truck: ordinary ground movement, including words that merely look maritime or aerial
    [
      "regional facility",
      "InTransit",
      "Departed USPS Regional Facility",
      "MEMPHIS TN DISTRIBUTION CENTER",
      "truck",
    ],
    [
      "sorting facility",
      "InTransit",
      "Arrived at sorting facility",
      "CHICAGO, IL",
      "truck",
    ],
    ["no wording at all", "InTransit", null, null, "truck"],
    [
      "Portland is not a port",
      "InTransit",
      "Arrived at facility",
      "PORTLAND, OR",
      "truck",
    ],
    [
      "Port Washington is a town",
      "InTransit",
      "Departed facility",
      "PORT WASHINGTON, NY",
      "truck",
    ],
    [
      "Oceanside is a town",
      "InTransit",
      "Departed facility",
      "OCEANSIDE, CA",
      "truck",
    ],
    [
      "Harbor Beach is a town",
      "InTransit",
      "Departed facility",
      "HARBOR BEACH, MI",
      "truck",
    ],
    [
      "Fairport is not an airport",
      "InTransit",
      "Departed facility",
      "FAIRPORT, NY",
      "truck",
    ],
    [
      "Airdrie is not an airport",
      "InTransit",
      "Departed facility",
      "AIRDRIE, AB",
      "truck",
    ],
    [
      "Newport is not a port",
      "InTransit",
      "Departed facility",
      "NEWPORT, RI",
      "truck",
    ],
    ["transport word", "InTransit", "Transport scan", null, "truck"],
    [
      "import and export scans",
      "InTransit",
      "Import scan / Export scan",
      null,
      "truck",
    ],
    [
      "port of entry is ambiguous",
      "InTransit",
      "Arrived at port of entry",
      "LAREDO, TX",
      "truck",
    ],
    [
      "extra whitespace and case",
      "InTransit",
      "  DEPARTED   ORIGIN   AIRPORT ",
      null,
      "plane",
    ],
  ];

  it.each(cases)("%s", (_name, status, message, location, expected) => {
    expect(inferMode(checkpoint(status, message, location), null)).toBe(
      expected,
    );
  });

  it("covers at least 30 realistic strings", () => {
    expect(cases.length).toBeGreaterThanOrEqual(30);
  });
});

describe("inferMode: long hops", () => {
  const hop = (km: number, hours: number) =>
    inferMode(
      checkpoint("InTransit", "Departed facility", "SOMEWHERE", {
        occurredAt: hoursAfter(hours),
        point: northOf(km),
      }),
      checkpoint("InTransit", "Arrived at facility", "ELSEWHERE", {
        point: ORIGIN,
      }),
    );

  it.each([
    [799, 23, "truck"],
    [800, 23, "truck"],
    [801, 23, "plane"],
    [801, 24, "plane"],
    [801, 25, "truck"],
    [2500, 12, "plane"],
    [2500, 48, "truck"],
    [50, 1, "truck"],
  ] as const)("%i km in %i h is %s", (km, hours, expected) => {
    expect(hop(km, hours)).toBe(expected);
  });

  it("uses the 800 km threshold", () => {
    expect(AIR_HOP_KM).toBe(800);
  });

  it("does not guess a flight when either end is not located", () => {
    const current = checkpoint("InTransit", "Departed facility", "X", {
      occurredAt: hoursAfter(2),
      point: northOf(3000),
    });
    expect(inferMode(current, null)).toBe("truck");
    expect(
      inferMode(
        current,
        checkpoint("InTransit", "Arrived", "Y", { point: null }),
      ),
    ).toBe("truck");
    expect(
      inferMode(
        { ...current, point: null },
        checkpoint("InTransit", "Arrived", "Y", { point: ORIGIN }),
      ),
    ).toBe("truck");
  });

  it("ignores a hop whose timestamps run backwards", () => {
    const current = checkpoint("InTransit", "Departed facility", "X", {
      occurredAt: T0,
      point: northOf(3000),
    });
    const previous = checkpoint("InTransit", "Arrived", "Y", {
      occurredAt: hoursAfter(5),
      point: ORIGIN,
    });
    expect(inferMode(current, previous)).toBe("truck");
  });

  it("lets wording win over distance, and status win over both", () => {
    const farPrevious = checkpoint("InTransit", "Arrived", "Y", {
      point: ORIGIN,
    });
    const ship = checkpoint("InTransit", "Vessel departed", "X", {
      occurredAt: hoursAfter(3),
      point: northOf(3000),
    });
    expect(inferMode(ship, farPrevious)).toBe("ship");

    const van = checkpoint("OutForDelivery", "Out for delivery", "X", {
      occurredAt: hoursAfter(3),
      point: northOf(3000),
    });
    expect(inferMode(van, farPrevious)).toBe("van");
  });
});

describe("shipmentMode", () => {
  it("is pin when there are no checkpoints", () => {
    expect(shipmentMode([])).toBe("pin");
  });

  it("takes the newest checkpoint's mode", () => {
    expect(
      shipmentMode([
        checkpoint("InTransit", "Departed origin airport", "X", {
          occurredAt: T0,
        }),
        checkpoint("OutForDelivery", "Out for delivery", "Y", {
          occurredAt: hoursAfter(30),
        }),
      ]),
    ).toBe("van");
  });

  it("measures the hop from the nearest earlier located checkpoint", () => {
    const located = checkpoint("InTransit", "Arrived", "A", {
      occurredAt: T0,
      point: ORIGIN,
    });
    const unlocated = checkpoint("InTransit", "Scan", null, {
      occurredAt: hoursAfter(2),
      point: null,
    });
    const newest = checkpoint("InTransit", "Departed facility", "B", {
      occurredAt: hoursAfter(6),
      point: northOf(1500),
    });
    expect(shipmentMode([located, unlocated, newest])).toBe("plane");
  });

  it("does not count a distant checkpoint outside the 24 hour window", () => {
    const old = checkpoint("InTransit", "Arrived", "A", {
      occurredAt: T0,
      point: ORIGIN,
    });
    const newest = checkpoint("InTransit", "Departed facility", "B", {
      occurredAt: hoursAfter(72),
      point: northOf(1500),
    });
    expect(shipmentMode([old, newest])).toBe("truck");
  });
});
