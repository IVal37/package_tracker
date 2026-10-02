// @vitest-environment node
import { afterEach, describe, expect, it, vi } from "vitest";
import { resetEnvCache } from "@/lib/env";
import {
  createTrackingProvider,
  getTrackingProvider,
  resetTrackingProviderCache,
} from "./index";
import { FakeProvider } from "./fake/provider";
import { Ship24Provider } from "./ship24/provider";

describe("createTrackingProvider", () => {
  it("builds the fake provider", () => {
    const provider = createTrackingProvider({
      TRACKING_PROVIDER: "fake",
      FAKE_WEBHOOK_SECRET: "s",
    });
    expect(provider).toBeInstanceOf(FakeProvider);
  });

  it("builds the Ship24 provider when keys are present", () => {
    const provider = createTrackingProvider({
      TRACKING_PROVIDER: "ship24",
      SHIP24_API_KEY: "key",
      SHIP24_WEBHOOK_SECRET: "hook",
      FAKE_WEBHOOK_SECRET: "s",
    });
    expect(provider).toBeInstanceOf(Ship24Provider);
  });

  it("throws a key-naming error if Ship24 is selected without keys", () => {
    expect(() =>
      createTrackingProvider({
        TRACKING_PROVIDER: "ship24",
        FAKE_WEBHOOK_SECRET: "s",
      }),
    ).toThrowError(/SHIP24_API_KEY/);
  });
});

describe("getTrackingProvider", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
    resetEnvCache();
    resetTrackingProviderCache();
  });

  const useEnv = (vars: Record<string, string>) => {
    vi.stubEnv(
      "DATABASE_URL",
      "postgresql://u:p@db.example.test:6543/postgres",
    );
    for (const [key, value] of Object.entries(vars)) vi.stubEnv(key, value);
    resetEnvCache();
    resetTrackingProviderCache();
  };

  it("defaults to the fake provider", () => {
    useEnv({});
    expect(getTrackingProvider()).toBeInstanceOf(FakeProvider);
  });

  it("uses Ship24 when TRACKING_PROVIDER=ship24", () => {
    useEnv({
      TRACKING_PROVIDER: "ship24",
      SHIP24_API_KEY: "key",
      SHIP24_WEBHOOK_SECRET: "hook",
    });
    expect(getTrackingProvider()).toBeInstanceOf(Ship24Provider);
  });

  it("returns the same instance on repeated calls", () => {
    useEnv({});
    expect(getTrackingProvider()).toBe(getTrackingProvider());
  });

  it("throws a named-key error for ship24 without keys", () => {
    useEnv({ TRACKING_PROVIDER: "ship24" });
    expect(() => getTrackingProvider()).toThrowError(
      "Invalid environment: missing SHIP24_API_KEY; missing SHIP24_WEBHOOK_SECRET",
    );
  });
});
