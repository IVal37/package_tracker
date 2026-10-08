import { describe, expect, it } from "vitest";
import { haversineKm } from "./distance";

const CHICAGO = { lat: 41.8781, lng: -87.6298 };
const MEMPHIS = { lat: 35.1495, lng: -90.049 };
const NEW_YORK = { lat: 40.7128, lng: -74.006 };
const LOS_ANGELES = { lat: 34.0522, lng: -118.2437 };
const LONDON = { lat: 51.5074, lng: -0.1278 };

describe("haversineKm", () => {
  it.each([
    ["Chicago to Memphis", CHICAGO, MEMPHIS, 775],
    ["New York to Los Angeles", NEW_YORK, LOS_ANGELES, 3936],
    ["New York to London", NEW_YORK, LONDON, 5570],
  ])("%s is about %i km", (_name, a, b, expected) => {
    expect(haversineKm(a, b)).toBeGreaterThan(expected * 0.99);
    expect(haversineKm(a, b)).toBeLessThan(expected * 1.01);
  });

  it("is zero for the same point", () => {
    expect(haversineKm(CHICAGO, CHICAGO)).toBe(0);
  });

  it("is symmetric", () => {
    expect(haversineKm(CHICAGO, MEMPHIS)).toBeCloseTo(
      haversineKm(MEMPHIS, CHICAGO),
      6,
    );
  });

  it("measures one degree of latitude as about 111 km", () => {
    expect(haversineKm({ lat: 0, lng: 0 }, { lat: 1, lng: 0 })).toBeCloseTo(
      111.19,
      1,
    );
  });

  it("handles points across the antimeridian", () => {
    expect(
      haversineKm({ lat: 0, lng: 179.5 }, { lat: 0, lng: -179.5 }),
    ).toBeCloseTo(111.19, 1);
  });
});
