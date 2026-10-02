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
