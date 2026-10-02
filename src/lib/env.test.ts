import { afterEach, describe, expect, it, vi } from "vitest";
import { getEnv, parseEnv, resetEnvCache } from "./env";

const valid = {
  DATABASE_URL: "postgresql://user:s3cret-pw@db.example.test:6543/postgres",
};

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
    vi.stubEnv("DATABASE_URL", valid.DATABASE_URL);
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

  it("rejects an unknown provider and an empty key without echoing values", () => {
    let message = "";
    try {
      parseEnv({
        ...valid,
        TRACKING_PROVIDER: "aftership",
        SHIP24_API_KEY: "",
      });
    } catch (error) {
      message = (error as Error).message;
    }
    expect(message).toContain("invalid TRACKING_PROVIDER");
    expect(message).toContain("invalid SHIP24_API_KEY");
    expect(message).not.toContain("aftership");
  });

  it("requires an explicit fake webhook secret in production", () => {
    expect(() => parseEnv({ ...valid, NODE_ENV: "production" })).toThrowError(
      "Invalid environment: missing FAKE_WEBHOOK_SECRET",
    );
    expect(
      parseEnv({
        ...valid,
        NODE_ENV: "production",
        FAKE_WEBHOOK_SECRET: "prod-secret",
      }).FAKE_WEBHOOK_SECRET,
    ).toBe("prod-secret");
  });
});
