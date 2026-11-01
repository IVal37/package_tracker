import { describe, expect, it } from "vitest";
import {
  DAY_MS,
  HOUR_MS,
  MINUTE_MS,
  hourBucket,
  msBefore,
  utcDay,
} from "./time";

describe("time units", () => {
  it("are in milliseconds", () => {
    expect(MINUTE_MS).toBe(60_000);
    expect(HOUR_MS).toBe(3_600_000);
    expect(DAY_MS).toBe(86_400_000);
  });
});

describe("msBefore", () => {
  it("goes back by the given amount without changing the input", () => {
    const date = new Date("2026-06-10T12:00:00Z");
    expect(msBefore(date, DAY_MS)).toEqual(new Date("2026-06-09T12:00:00Z"));
    expect(date).toEqual(new Date("2026-06-10T12:00:00Z"));
  });
});

describe("hourBucket", () => {
  it("is the same within an hour and moves on at the next", () => {
    const start = new Date("2026-06-10T12:00:00Z");
    const end = new Date("2026-06-10T12:59:59.999Z");
    const next = new Date("2026-06-10T13:00:00Z");
    expect(hourBucket(end)).toBe(hourBucket(start));
    expect(hourBucket(next)).toBe(hourBucket(start) + 1);
  });
});

describe("utcDay", () => {
  it("uses the UTC day, not the local one", () => {
    expect(utcDay(new Date("2026-06-10T23:30:00-05:00"))).toBe("2026-06-11");
  });
});
