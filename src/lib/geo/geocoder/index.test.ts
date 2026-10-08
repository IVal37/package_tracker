// @vitest-environment node
import { afterEach, describe, expect, it, vi } from "vitest";

const { getEnv } = vi.hoisted(() => ({ getEnv: vi.fn() }));
vi.mock("@/lib/env", () => ({ getEnv }));

import { createGeocoder, getGeocoder, resetGeocoderCache } from "./index";

afterEach(() => {
  resetGeocoderCache();
  getEnv.mockReset();
});

describe("createGeocoder", () => {
  it("builds the fake geocoder by default", () => {
    const geocoder = createGeocoder({
      GEOCODER: "fake",
      APP_URL: "http://localhost:3000",
    });
    expect(geocoder.name).toBe("fake");
  });

  it("builds Nominatim, identifying the app by its URL", async () => {
    const calls: string[] = [];
    vi.stubGlobal(
      "fetch",
      vi.fn(async (_url: URL, init: RequestInit) => {
        calls.push(new Headers(init.headers).get("user-agent") ?? "");
        return new Response("[]", { status: 200 });
      }),
    );
    try {
      const geocoder = createGeocoder({
        GEOCODER: "nominatim",
        APP_URL: "https://wayfind.example.test",
      });
      expect(geocoder.name).toBe("nominatim");
      await geocoder.geocode("X");
      expect(calls).toEqual(["Wayfind/0.1 (+https://wayfind.example.test)"]);
    } finally {
      vi.unstubAllGlobals();
    }
  });
});

describe("getGeocoder", () => {
  it("reads the env once and caches the result", () => {
    getEnv.mockReturnValue({ GEOCODER: "fake", APP_URL: "http://localhost" });

    const first = getGeocoder();
    const second = getGeocoder();

    expect(second).toBe(first);
    expect(getEnv).toHaveBeenCalledTimes(1);
  });

  it("builds a fresh one after the cache is reset", () => {
    getEnv.mockReturnValue({ GEOCODER: "fake", APP_URL: "http://localhost" });
    const first = getGeocoder();
    resetGeocoderCache();
    expect(getGeocoder()).not.toBe(first);
  });
});
