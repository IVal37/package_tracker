// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from "vitest";

const { trackersCreatedPerDay, adminCounts } = vi.hoisted(() => ({
  trackersCreatedPerDay: vi.fn(),
  adminCounts: vi.fn(),
}));
vi.mock("@/lib/db/admin-stats", () => ({ trackersCreatedPerDay, adminCounts }));

import { isAdmin, loadAdminStats } from "./index";

const COUNTS = {
  users: 3,
  activeShipments: 7,
  failedEmails: 1,
  failedNotifications: 0,
  oldestPendingEmail: null,
  oldestPendingNotification: null,
};

beforeEach(() => {
  trackersCreatedPerDay.mockReset();
  adminCounts.mockReset();
  adminCounts.mockResolvedValue(COUNTS);
});

describe("isAdmin", () => {
  it("matches a listed email whatever its case", () => {
    expect(isAdmin("Ops@Example.test ", ["ops@example.test"])).toBe(true);
    expect(isAdmin("someone@example.test", ["ops@example.test"])).toBe(false);
  });

  it("lets nobody in when the list is empty", () => {
    expect(isAdmin("ops@example.test", [])).toBe(false);
  });
});

describe("loadAdminStats", () => {
  it("fills in 30 days, sums the month and passes the 7-day failure window", async () => {
    const now = new Date("2026-10-09T12:00:00Z");
    trackersCreatedPerDay.mockResolvedValue([
      { day: "2026-09-25", count: 4 },
      { day: "2026-10-01", count: 2 },
      { day: "2026-10-09", count: 1 },
    ]);

    const stats = await loadAdminStats({
      db: "db" as never,
      provider: "ship24",
      allowance: 500,
      now,
    });

    expect(stats.trackersPerDay).toHaveLength(30);
    expect(stats.trackersPerDay[0]).toEqual({ day: "2026-09-10", count: 0 });
    expect(stats.trackersPerDay.at(-1)).toEqual({
      day: "2026-10-09",
      count: 1,
    });
    expect(
      stats.trackersPerDay.find((d) => d.day === "2026-09-25")?.count,
    ).toBe(4);
    expect(stats.monthSoFar).toBe(3);
    expect(stats).toMatchObject({
      ...COUNTS,
      provider: "ship24",
      allowance: 500,
    });
    expect(trackersCreatedPerDay).toHaveBeenCalledWith(
      "db",
      "ship24",
      new Date("2026-09-10T00:00:00Z"),
    );
    expect(adminCounts).toHaveBeenCalledWith(
      "db",
      new Date("2026-10-02T12:00:00Z"),
    );
  });

  it("reaches back to the 1st when the month is longer than the window", async () => {
    trackersCreatedPerDay.mockResolvedValue([{ day: "2026-10-01", count: 5 }]);
    const stats = await loadAdminStats({
      db: "db" as never,
      provider: "ship24",
      allowance: null,
      now: new Date("2026-10-31T23:00:00Z"),
    });
    expect(trackersCreatedPerDay.mock.calls[0]?.[2]).toEqual(
      new Date("2026-10-01T00:00:00Z"),
    );
    expect(stats.monthSoFar).toBe(5);
    expect(stats.allowance).toBeNull();
  });
});
