// @vitest-environment node
import { describe, expect, it } from "vitest";
import { createTrackingProvider } from "@/lib/tracking";
import { FakeGeocoder } from "./fake";

const geocoder = new FakeGeocoder();

describe("FakeGeocoder", () => {
  it("finds a known place whatever the case or spacing", async () => {
    const result = await geocoder.geocode("  MEMPHIS,   TN ");
    expect(result?.lat).toBeCloseTo(35.1495, 3);
    expect(result?.lng).toBeCloseTo(-90.049, 3);
  });

  it("returns null for an unknown place", async () => {
    expect(await geocoder.geocode("ATLANTIS")).toBeNull();
  });

  it("never touches the network (MSW would fail the test on an unhandled request)", async () => {
    await expect(geocoder.geocode("CHICAGO, IL")).resolves.not.toBeNull();
  });

  // The fake tracking scenarios must be fully mappable in development, so
  // anything they mention has to resolve here. This catches the two drifting.
  it("knows every place the fake tracking scenarios mention", async () => {
    const provider = createTrackingProvider({
      TRACKING_PROVIDER: "fake",
      FAKE_WEBHOOK_SECRET: "s",
    });
    const names = [
      "TRANSIT",
      "OFD",
      "DELIVERED",
      "EXCEPTION",
      "PENDING",
      "AIR",
    ];
    const places = new Set<string>();
    for (const name of names) {
      const shipment = await provider.createTracking({
        trackingNumber: `FAKE-${name}-1`,
      });
      if (shipment.destination) places.add(shipment.destination);
      for (const event of shipment.events) {
        if (event.locationText) places.add(event.locationText);
      }
    }

    expect(places.size).toBeGreaterThan(8);
    for (const place of places) {
      expect(await geocoder.geocode(place), place).not.toBeNull();
    }
  });
});
