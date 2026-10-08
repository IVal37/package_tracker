import { afterEach, describe, expect, it, vi } from "vitest";
import { requiredEnv, stubRequiredEnv } from "../../tests/env";
import { getEnv, parseEnv, resetEnvCache } from "./env";

const valid = requiredEnv;

describe("parseEnv", () => {
  it("parses valid input and applies defaults", () => {
    const env = parseEnv(valid);
    expect(env.DATABASE_URL).toBe(valid.DATABASE_URL);
    expect(env.DATABASE_URL_DIRECT).toBeUndefined();
    expect(env.NODE_ENV).toBe("development");
  });

  it("accepts the optional direct URL and an explicit NODE_ENV", () => {
    const env = parseEnv({
      ...valid,
      DATABASE_URL_DIRECT: "postgresql://u:p@db.example.test:5432/postgres",
      NODE_ENV: "test",
    });
    expect(env.DATABASE_URL_DIRECT).toContain("5432");
    expect(env.NODE_ENV).toBe("test");
  });

  it("throws an error naming a missing key", () => {
    expect(() => parseEnv({})).toThrowError(
      "Invalid environment: missing DATABASE_URL",
    );
  });

  it("throws on a malformed URL and names the key", () => {
    expect(() => parseEnv({ DATABASE_URL: "not-a-url" })).toThrowError(
      "Invalid environment: invalid DATABASE_URL",
    );
  });

  it("lists every bad key", () => {
    expect(() =>
      parseEnv({ DATABASE_URL: "x", DATABASE_URL_DIRECT: "y" }),
    ).toThrowError(/invalid DATABASE_URL; invalid DATABASE_URL_DIRECT/);
  });

  it("never includes secret values in the error message", () => {
    let message = "";
    try {
      parseEnv({ DATABASE_URL: "s3cret-pw", NODE_ENV: "hunter2" });
    } catch (error) {
      message = (error as Error).message;
    }
    expect(message).not.toBe("");
    expect(message).not.toContain("s3cret-pw");
    expect(message).not.toContain("hunter2");
  });
});

describe("getEnv", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
    resetEnvCache();
  });

  it("reads process.env lazily and caches the result", () => {
    stubRequiredEnv();
    const first = getEnv();
    vi.stubEnv("DATABASE_URL", "postgresql://other:pw@elsewhere.test/db");
    expect(getEnv()).toBe(first);
  });

  it("throws when process.env is missing a key", () => {
    vi.stubEnv("DATABASE_URL", "");
    delete process.env.DATABASE_URL;
    expect(() => getEnv()).toThrowError(/missing DATABASE_URL/);
  });
});

describe("tracking provider env", () => {
  it("defaults to the fake provider with a development webhook secret", () => {
    const env = parseEnv(valid);
    expect(env.TRACKING_PROVIDER).toBe("fake");
    expect(env.FAKE_WEBHOOK_SECRET).toBe("fake-secret");
  });

  it("requires both Ship24 keys when TRACKING_PROVIDER=ship24", () => {
    expect(() =>
      parseEnv({ ...valid, TRACKING_PROVIDER: "ship24" }),
    ).toThrowError(
      "Invalid environment: missing SHIP24_API_KEY; missing SHIP24_WEBHOOK_SECRET",
    );
  });

  it("names only the Ship24 key that is missing", () => {
    expect(() =>
      parseEnv({
        ...valid,
        TRACKING_PROVIDER: "ship24",
        SHIP24_API_KEY: "key-value",
      }),
    ).toThrowError("Invalid environment: missing SHIP24_WEBHOOK_SECRET");
  });

  it("accepts ship24 with both keys", () => {
    const env = parseEnv({
      ...valid,
      TRACKING_PROVIDER: "ship24",
      SHIP24_API_KEY: "key-value",
      SHIP24_WEBHOOK_SECRET: "hook-value",
    });
    expect(env.SHIP24_API_KEY).toBe("key-value");
  });

  it("does not require Ship24 keys for the fake provider", () => {
    expect(() =>
      parseEnv({ ...valid, TRACKING_PROVIDER: "fake" }),
    ).not.toThrow();
  });

  it("rejects an unknown provider without echoing the value", () => {
    let message = "";
    try {
      parseEnv({ ...valid, TRACKING_PROVIDER: "aftership" });
    } catch (error) {
      message = (error as Error).message;
    }
    expect(message).toBe("Invalid environment: invalid TRACKING_PROVIDER");
  });

  // `KEY=` with no value is how .env.example ships optional keys.
  it("treats blank optional values as unset", () => {
    const env = parseEnv({
      ...valid,
      TRACKING_PROVIDER: "",
      SHIP24_API_KEY: "",
      SHIP24_WEBHOOK_SECRET: "",
      FAKE_WEBHOOK_SECRET: "",
      DATABASE_URL_DIRECT: "",
    });
    expect(env.TRACKING_PROVIDER).toBe("fake");
    expect(env.SHIP24_API_KEY).toBeUndefined();
    expect(env.FAKE_WEBHOOK_SECRET).toBe("fake-secret");
    expect(env.DATABASE_URL_DIRECT).toBeUndefined();
  });

  it("still requires Ship24 keys when they are blank and ship24 is selected", () => {
    expect(() =>
      parseEnv({
        ...valid,
        TRACKING_PROVIDER: "ship24",
        SHIP24_API_KEY: "",
        SHIP24_WEBHOOK_SECRET: "",
      }),
    ).toThrowError(
      "Invalid environment: missing SHIP24_API_KEY; missing SHIP24_WEBHOOK_SECRET",
    );
  });

  it("reports a blank required value as missing", () => {
    expect(() => parseEnv({ ...valid, SUPABASE_URL: "" })).toThrowError(
      "Invalid environment: missing SUPABASE_URL",
    );
  });

  it("requires an explicit fake webhook secret in production", () => {
    expect(() =>
      parseEnv({
        ...valid,
        NODE_ENV: "production",
        INNGEST_SIGNING_KEY: "signkey-test",
        INNGEST_EVENT_KEY: "eventkey-test",
      }),
    ).toThrowError("Invalid environment: missing FAKE_WEBHOOK_SECRET");
    expect(
      parseEnv({
        ...valid,
        NODE_ENV: "production",
        FAKE_WEBHOOK_SECRET: "prod-secret",
        INNGEST_SIGNING_KEY: "signkey-test",
        INNGEST_EVENT_KEY: "eventkey-test",
      }).FAKE_WEBHOOK_SECRET,
    ).toBe("prod-secret");
  });
});

describe("inngest env", () => {
  const production = {
    ...valid,
    NODE_ENV: "production",
    FAKE_WEBHOOK_SECRET: "prod-secret",
  };
  const withKeys = {
    ...production,
    INNGEST_SIGNING_KEY: "signkey-test",
    INNGEST_EVENT_KEY: "eventkey-test",
  };

  it("requires both Inngest keys in production, naming only the keys", () => {
    expect(() => parseEnv(production)).toThrowError(
      "Invalid environment: missing INNGEST_SIGNING_KEY; missing INNGEST_EVENT_KEY",
    );
    expect(() =>
      parseEnv({ ...withKeys, INNGEST_SIGNING_KEY: "" }),
    ).toThrowError("Invalid environment: missing INNGEST_SIGNING_KEY");
    expect(() => parseEnv({ ...withKeys, INNGEST_EVENT_KEY: "" })).toThrowError(
      "Invalid environment: missing INNGEST_EVENT_KEY",
    );
  });

  it("accepts both keys in production", () => {
    const env = parseEnv(withKeys);
    expect(env.INNGEST_SIGNING_KEY).toBe("signkey-test");
    expect(env.INNGEST_EVENT_KEY).toBe("eventkey-test");
  });

  it("does not need them in development or test", () => {
    for (const NODE_ENV of ["development", "test"]) {
      const env = parseEnv({ ...valid, NODE_ENV });
      expect(env.INNGEST_SIGNING_KEY).toBeUndefined();
      expect(env.INNGEST_EVENT_KEY).toBeUndefined();
    }
  });
});

describe("geocoder env", () => {
  it("defaults to the fake geocoder", () => {
    expect(parseEnv(valid).GEOCODER).toBe("fake");
    expect(parseEnv({ ...valid, GEOCODER: "" }).GEOCODER).toBe("fake");
  });

  it("accepts nominatim", () => {
    expect(parseEnv({ ...valid, GEOCODER: "nominatim" }).GEOCODER).toBe(
      "nominatim",
    );
  });

  it("rejects an unknown geocoder without echoing the value", () => {
    expect(() => parseEnv({ ...valid, GEOCODER: "google" })).toThrowError(
      "Invalid environment: invalid GEOCODER",
    );
  });
});

describe("supabase env", () => {
  it("requires SUPABASE_URL and SUPABASE_PUBLISHABLE_KEY, naming them", () => {
    expect(() => parseEnv({ DATABASE_URL: valid.DATABASE_URL })).toThrowError(
      "Invalid environment: missing SUPABASE_URL; missing SUPABASE_PUBLISHABLE_KEY",
    );
  });

  it("rejects a malformed SUPABASE_URL without echoing it", () => {
    let message = "";
    try {
      parseEnv({ ...valid, SUPABASE_URL: "not-a-url-value" });
    } catch (error) {
      message = (error as Error).message;
    }
    expect(message).toBe("Invalid environment: invalid SUPABASE_URL");
  });

  it("defaults APP_URL to localhost and accepts an override", () => {
    expect(parseEnv(valid).APP_URL).toBe("http://localhost:3000");
    expect(
      parseEnv({ ...valid, APP_URL: "https://wayfind.example.test" }).APP_URL,
    ).toBe("https://wayfind.example.test");
  });
});
