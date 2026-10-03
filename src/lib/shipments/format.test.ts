import { describe, expect, it } from "vitest";
import { formatEta, formatRelativeTime } from "./format";

const d = (iso: string) => new Date(iso);

describe("formatEta", () => {
  const now = d("2026-06-10T12:00:00Z"); // a Wednesday

  it.each([
    [null, "No ETA"],
    ["2026-06-10T23:59:59Z", "Today"],
    ["2026-06-10T00:00:00Z", "Today"],
    ["2026-06-11T08:00:00Z", "Tomorrow"],
    ["2026-06-09T23:59:59Z", "Overdue"],
    ["2026-06-12T08:00:00Z", "Friday"],
    ["2026-06-16T08:00:00Z", "Tuesday"],
    ["2026-06-17T08:00:00Z", "Jun 17"],
    ["2026-07-04T08:00:00Z", "Jul 4"],
  ])("%s -> %s", (eta, expected) => {
    expect(formatEta(eta ? d(eta) : null, now)).toBe(expected);
  });

  it("uses calendar days in the given time zone, not 24-hour spans", () => {
    // 11pm in New York on Jun 10 (03:00 UTC Jun 11) is still "today" there.
    const lateNight = d("2026-06-11T03:00:00Z");
    expect(formatEta(lateNight, now, "UTC")).toBe("Tomorrow");
    expect(formatEta(lateNight, now, "America/New_York")).toBe("Today");
  });

  it("is correct across a daylight-saving change", () => {
    // US clocks spring forward on 2026-03-08.
    const before = d("2026-03-07T20:00:00Z");
    const after = d("2026-03-08T20:00:00Z");
    expect(formatEta(after, before, "America/New_York")).toBe("Tomorrow");
  });
});

describe("formatRelativeTime", () => {
  const now = d("2026-06-10T12:00:00Z");

  it.each([
    ["2026-06-10T11:59:40Z", "just now"],
    ["2026-06-10T11:55:00Z", "5 minutes ago"],
    ["2026-06-10T11:59:00Z", "1 minute ago"],
    ["2026-06-10T09:00:00Z", "3 hours ago"],
    ["2026-06-09T11:00:00Z", "yesterday"],
    ["2026-06-07T12:00:00Z", "3 days ago"],
  ])("%s -> %s", (iso, expected) => {
    expect(formatRelativeTime(d(iso), now)).toBe(expected);
  });
});
