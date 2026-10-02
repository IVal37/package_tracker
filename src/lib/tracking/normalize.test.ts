import { describe, expect, it } from "vitest";
import { ProviderResponseError } from "./errors";
import {
  dedupeEvents,
  normalizeTrackingNumber,
  parseLogisticsDate,
} from "./normalize";
import type { NormalizedEvent } from "./types";

describe("parseLogisticsDate", () => {
  it.each([
    ["2021-03-04T10:12:57.000Z", "2021-03-04T10:12:57.000Z"],
    ["2021-03-04T10:12:57+02:00", "2021-03-04T08:12:57.000Z"],
    ["2021-03-04T10:12:57-0500", "2021-03-04T15:12:57.000Z"],
    ["2021-03-04T17:12:57", "2021-03-04T17:12:57.000Z"],
    ["2021-03-04", "2021-03-04T00:00:00.000Z"],
    ["  2021-03-04T17:12:57  ", "2021-03-04T17:12:57.000Z"],
  ])("parses %s", (input, expected) => {
    expect(parseLogisticsDate(input).toISOString()).toBe(expected);
  });

  it.each(["", "not-a-date", "2021-13-45T99:99:99"])(
    "throws ProviderResponseError for %j",
    (input) => {
      expect(() => parseLogisticsDate(input)).toThrow(ProviderResponseError);
    },
  );
});

const event = (
  id: string,
  iso: string,
  order: number | null = null,
): NormalizedEvent => ({
  providerEventId: id,
  occurredAt: new Date(iso),
  status: "InTransit",
  message: null,
  locationText: null,
  courierCode: null,
  order,
});

describe("dedupeEvents", () => {
  it("removes repeated ids, keeping the first", () => {
    const first = event("a", "2026-01-01T00:00:00Z");
    const dup = { ...first, message: "duplicate" };
    const result = dedupeEvents([first, dup]);
    expect(result).toHaveLength(1);
    expect(result[0]?.message).toBeNull();
  });

  it("sorts newest first", () => {
    const result = dedupeEvents([
      event("old", "2026-01-01T00:00:00Z"),
      event("new", "2026-01-03T00:00:00Z"),
      event("mid", "2026-01-02T00:00:00Z"),
    ]);
    expect(result.map((e) => e.providerEventId)).toEqual(["new", "mid", "old"]);
  });

  it("breaks timestamp ties by higher order first", () => {
    const result = dedupeEvents([
      event("low", "2026-01-01T00:00:00Z", 1),
      event("high", "2026-01-01T00:00:00Z", 2),
      event("none", "2026-01-01T00:00:00Z", null),
    ]);
    expect(result.map((e) => e.providerEventId)).toEqual([
      "high",
      "low",
      "none",
    ]);
  });

  it("returns an empty array for no events", () => {
    expect(dedupeEvents([])).toEqual([]);
  });

  it("does not mutate its input", () => {
    const input = [
      event("a", "2026-01-01T00:00:00Z"),
      event("b", "2026-01-02T00:00:00Z"),
    ];
    dedupeEvents(input);
    expect(input.map((e) => e.providerEventId)).toEqual(["a", "b"]);
  });
});

describe("normalizeTrackingNumber", () => {
  it.each([
    ["  9400 1159 0104 7177 5982 06 ", "9400115901047177598206"],
    ["1z999aa10123456784", "1Z999AA10123456784"],
    ["ab-12\t34", "AB-1234"],
    ["", ""],
  ])("%j -> %j", (input, expected) => {
    expect(normalizeTrackingNumber(input)).toBe(expected);
  });
});
