import { describe, expect, it } from "vitest";
import type { MapCheckpoint, MapShipment } from "@/lib/db/shipments";
import type { Status } from "@/lib/tracking";
import { buildMapData } from "./map-data";

const T0 = new Date("2026-06-01T00:00:00Z");
const hoursAfter = (hours: number) =>
  new Date(T0.getTime() + hours * 3_600_000);

const MEMPHIS = { lat: 35.1495, lng: -90.049 };
const CHICAGO = { lat: 41.8781, lng: -87.6298 };
const OAKLAND = { lat: 37.8044, lng: -122.2712 };
const SF = { lat: 37.7749, lng: -122.4194 };

const cp = (
  hour: number,
  point: MapCheckpoint["point"],
  extra: Partial<MapCheckpoint> = {},
): MapCheckpoint => ({
  status: "InTransit",
  message: "Arrived at facility",
  locationText: point ? "SOMEWHERE" : null,
  occurredAt: hoursAfter(hour),
  point,
  ...extra,
});

const shipment = (
  id: string,
  checkpoints: MapCheckpoint[],
  extra: Partial<MapShipment> = {},
): MapShipment => ({
  id,
  name: `Package ${id}`,
  status: "InTransit" as Status,
  destination: null,
  checkpoints,
  ...extra,
});

describe("buildMapData: placing icons", () => {
  it("puts the icon at the newest located checkpoint", () => {
    const data = buildMapData([
      shipment("a", [cp(1, MEMPHIS), cp(5, CHICAGO)]),
    ]);

    expect(data.points.features).toHaveLength(1);
    const feature = data.points.features[0];
    // GeoJSON order is [lng, lat].
    expect(feature?.geometry.coordinates).toEqual([CHICAGO.lng, CHICAGO.lat]);
    expect(feature?.properties).toMatchObject({
      id: "a",
      name: "Package a",
      status: "InTransit",
      mode: "truck",
      fallback: false,
    });
  });

  it("skips unlocated checkpoints when choosing the spot", () => {
    const data = buildMapData([
      shipment("a", [cp(1, MEMPHIS), cp(5, null), cp(9, null)]),
    ]);
    expect(data.points.features[0]?.geometry.coordinates).toEqual([
      MEMPHIS.lng,
      MEMPHIS.lat,
    ]);
  });

  it("takes the mode from the newest checkpoint even when it has no location", () => {
    const data = buildMapData([
      shipment(
        "a",
        [
          cp(1, OAKLAND),
          cp(9, null, {
            status: "OutForDelivery",
            message: "Out for delivery",
          }),
        ],
        { status: "OutForDelivery" },
      ),
    ]);
    const feature = data.points.features[0];
    expect(feature?.properties.mode).toBe("van");
    // ...but it is still drawn where we last knew it to be.
    expect(feature?.geometry.coordinates).toEqual([OAKLAND.lng, OAKLAND.lat]);
  });

  it("picks plane, ship and van per shipment", () => {
    const data = buildMapData([
      shipment("air", [cp(1, MEMPHIS, { message: "Departed origin airport" })]),
      shipment("sea", [cp(1, OAKLAND, { message: "Vessel departed" })]),
      shipment("van", [cp(1, SF, { status: "OutForDelivery" })], {
        status: "OutForDelivery",
      }),
    ]);
    const modes = Object.fromEntries(
      data.points.features.map((f) => [f.properties.id, f.properties.mode]),
    );
    expect(modes).toEqual({ air: "plane", sea: "ship", van: "van" });
  });

  it("lists each placed shipment with its mode", () => {
    const data = buildMapData([shipment("a", [cp(1, MEMPHIS)])]);
    expect(data.placed).toEqual([
      { id: "a", name: "Package a", status: "InTransit", mode: "truck" },
    ]);
    expect(data.unplaced).toEqual([]);
  });
});

describe("buildMapData: routes", () => {
  it("draws a line through located checkpoints in time order", () => {
    const data = buildMapData([
      shipment("a", [cp(1, MEMPHIS), cp(3, null), cp(5, CHICAGO)]),
    ]);

    expect(data.routes.features).toHaveLength(1);
    expect(data.routes.features[0]?.geometry.coordinates).toEqual([
      [MEMPHIS.lng, MEMPHIS.lat],
      [CHICAGO.lng, CHICAGO.lat],
    ]);
    expect(data.routes.features[0]?.properties).toEqual({ id: "a" });
  });

  it("collapses consecutive checkpoints at the same spot", () => {
    const data = buildMapData([
      shipment("a", [
        cp(1, MEMPHIS),
        cp(2, MEMPHIS),
        cp(3, CHICAGO),
        cp(4, CHICAGO),
        cp(5, MEMPHIS),
      ]),
    ]);
    expect(data.routes.features[0]?.geometry.coordinates).toEqual([
      [MEMPHIS.lng, MEMPHIS.lat],
      [CHICAGO.lng, CHICAGO.lat],
      [MEMPHIS.lng, MEMPHIS.lat],
    ]);
  });

  it("draws no line for a single place, however many scans happened there", () => {
    const data = buildMapData([
      shipment("a", [cp(1, MEMPHIS), cp(2, MEMPHIS), cp(3, MEMPHIS)]),
    ]);
    expect(data.routes.features).toEqual([]);
    expect(data.points.features).toHaveLength(1);
  });

  it("draws Asia to the US across the Pacific, not the long way round", () => {
    const shenzhen = { lat: 22.64, lng: 113.81 };
    const losAngeles = { lat: 33.94, lng: -118.41 };
    const data = buildMapData([
      shipment("a", [cp(1, shenzhen), cp(30, losAngeles)]),
    ]);

    const [start, end] = data.routes.features[0]!.geometry.coordinates;
    expect(start).toEqual([113.81, 22.64]);
    // Shifted east past 180 so the segment is ~128 degrees, not ~232.
    expect(end).toEqual([-118.41 + 360, 33.94]);
    expect(Math.abs(end![0] - start![0])).toBeLessThan(180);
  });

  it("unwraps back and forth across the date line", () => {
    const tokyo = { lat: 35.7, lng: 139.7 };
    const seattle = { lat: 47.6, lng: -122.3 };
    const data = buildMapData([
      shipment("a", [cp(1, tokyo), cp(10, seattle), cp(20, tokyo)]),
    ]);

    const longitudes = data.routes.features[0]!.geometry.coordinates.map(
      ([lng]) => lng,
    );
    expect(longitudes).toEqual([139.7, 237.7, 139.7]);
  });

  it("leaves routes that do not cross the date line untouched", () => {
    const data = buildMapData([
      shipment("a", [cp(1, MEMPHIS), cp(2, CHICAGO), cp(3, OAKLAND)]),
    ]);
    expect(data.routes.features[0]?.geometry.coordinates).toEqual([
      [MEMPHIS.lng, MEMPHIS.lat],
      [CHICAGO.lng, CHICAGO.lat],
      [OAKLAND.lng, OAKLAND.lat],
    ]);
  });

  it("keeps one route per shipment", () => {
    const data = buildMapData([
      shipment("a", [cp(1, MEMPHIS), cp(2, CHICAGO)]),
      shipment("b", [cp(1, OAKLAND), cp(2, SF)]),
    ]);
    expect(data.routes.features.map((f) => f.properties.id)).toEqual([
      "a",
      "b",
    ]);
  });
});

describe("buildMapData: destination fallback", () => {
  it("pins the destination when no checkpoint is located", () => {
    const data = buildMapData([
      shipment("a", [cp(1, null), cp(2, null)], { destination: SF }),
    ]);

    expect(data.points.features).toHaveLength(1);
    expect(data.points.features[0]?.geometry.coordinates).toEqual([
      SF.lng,
      SF.lat,
    ]);
    expect(data.points.features[0]?.properties).toMatchObject({
      mode: "pin",
      fallback: true,
    });
    expect(data.routes.features).toEqual([]);
    expect(data.placed).toEqual([
      { id: "a", name: "Package a", status: "InTransit", mode: "pin" },
    ]);
  });

  it("pins the destination for a shipment with no checkpoints at all", () => {
    const data = buildMapData([
      shipment("a", [], { status: "Pending", destination: SF }),
    ]);
    expect(data.points.features[0]?.properties).toMatchObject({
      mode: "pin",
      fallback: true,
    });
  });

  it("prefers a real checkpoint over the destination", () => {
    const data = buildMapData([
      shipment("a", [cp(1, MEMPHIS)], { destination: SF }),
    ]);
    expect(data.points.features[0]?.properties.fallback).toBe(false);
    expect(data.points.features[0]?.geometry.coordinates).toEqual([
      MEMPHIS.lng,
      MEMPHIS.lat,
    ]);
  });

  it("lists a shipment with no location at all as unplaced instead of dropping it", () => {
    const data = buildMapData([
      shipment("lost", [cp(1, null, { status: "InfoReceived" })], {
        status: "InfoReceived",
      }),
    ]);

    expect(data.points.features).toEqual([]);
    expect(data.routes.features).toEqual([]);
    expect(data.placed).toEqual([]);
    expect(data.unplaced).toEqual([
      { id: "lost", name: "Package lost", status: "InfoReceived", mode: "pin" },
    ]);
  });
});

describe("buildMapData: edge cases", () => {
  it("handles no shipments", () => {
    const data = buildMapData([]);
    expect(data.points.features).toEqual([]);
    expect(data.routes.features).toEqual([]);
    expect(data.placed).toEqual([]);
    expect(data.unplaced).toEqual([]);
  });

  it("splits a mixed set into placed and unplaced, keeping order", () => {
    const data = buildMapData([
      shipment("a", [cp(1, MEMPHIS)]),
      shipment("b", []),
      shipment("c", [], { destination: SF }),
    ]);
    expect(data.placed.map((s) => s.id)).toEqual(["a", "c"]);
    expect(data.unplaced.map((s) => s.id)).toEqual(["b"]);
  });

  it("returns well-formed GeoJSON collections", () => {
    const data = buildMapData([
      shipment("a", [cp(1, MEMPHIS), cp(2, CHICAGO)]),
    ]);
    expect(data.points.type).toBe("FeatureCollection");
    expect(data.routes.type).toBe("FeatureCollection");
    expect(data.points.features[0]?.type).toBe("Feature");
    expect(data.routes.features[0]?.geometry.type).toBe("LineString");
  });
});
