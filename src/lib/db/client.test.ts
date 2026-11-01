// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { postgresMock, drizzleMock } = vi.hoisted(() => ({
  postgresMock: vi.fn(() => ({ end: vi.fn() })),
  drizzleMock: vi.fn(() => ({ execute: vi.fn() })),
}));

vi.mock("postgres", () => ({ default: postgresMock }));
vi.mock("drizzle-orm/postgres-js", () => ({ drizzle: drizzleMock }));

import { resetEnvCache } from "@/lib/env";
import { stubRequiredEnv } from "../../../tests/env";
import { createDb, getDb, resetDbCache } from "./client";

const testUrl = "postgresql://user:pw@db.example.test:6543/postgres";

beforeEach(() => {
  vi.clearAllMocks();
});

describe("createDb", () => {
  it("passes the URL and prepare:false to the driver", () => {
    createDb(testUrl);
    expect(postgresMock).toHaveBeenCalledWith(
      testUrl,
      expect.objectContaining({ prepare: false }),
    );
  });

  it("honours a custom pool size", () => {
    createDb(testUrl, { max: 3 });
    expect(postgresMock).toHaveBeenCalledWith(
      testUrl,
      expect.objectContaining({ max: 3 }),
    );
  });

  it("returns the drizzle db and the raw client", () => {
    const { db, sql } = createDb(testUrl);
    expect(db).toHaveProperty("execute");
    expect(sql).toHaveProperty("end");
  });
});

describe("getDb", () => {
  beforeEach(() => {
    stubRequiredEnv({ DATABASE_URL: testUrl });
    resetEnvCache();
    resetDbCache();
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    resetEnvCache();
    resetDbCache();
  });

  it("returns the same instance on repeated calls", () => {
    expect(getDb()).toBe(getDb());
    expect(postgresMock).toHaveBeenCalledTimes(1);
    expect(postgresMock).toHaveBeenCalledWith(testUrl, expect.anything());
  });
});
