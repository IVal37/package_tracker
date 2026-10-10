// @vitest-environment node
import { InngestTestEngine } from "@inngest/test";
import { beforeEach, describe, expect, it, vi } from "vitest";

const { archiveDeliveredShipments, expireQuietShipments, cleanupRateLimits } =
  vi.hoisted(() => ({
    archiveDeliveredShipments: vi.fn(),
    expireQuietShipments: vi.fn(),
    cleanupRateLimits: vi.fn(),
  }));

vi.mock("@/lib/shipments/sync/archive-delivered", () => ({
  archiveDeliveredShipments,
}));
vi.mock("@/lib/shipments/sync/expire-quiet", () => ({
  expireQuietShipments,
}));
vi.mock("@/lib/ratelimit", () => ({ cleanupRateLimits }));
vi.mock("@/lib/env", () => ({ getEnv: () => ({ EXPIRE_AFTER_DAYS: 45 }) }));
vi.mock("@/lib/db/client", () => ({ getDb: () => "db" }));
vi.mock("@/lib/tracking", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/tracking")>()),
  getTrackingProvider: () => "provider",
}));

import { archiveDelivered, expireQuiet } from "./archive-delivered";
import { geocodePlaceJob, geocodeSweep } from "./geocode";
import { emailCleanup, emailSweep, processEmailJob } from "./inbound-email";
import { functions } from "./index";
import {
  notificationsCleanup,
  notificationsSweep,
  sendNotificationJob,
} from "./notifications";
import { rateLimitsCleanup } from "./rate-limits";
import { refetchStale, refetchTrackerJob } from "./refetch-stale";

beforeEach(() => {
  archiveDeliveredShipments.mockReset();
});

describe("archiveDelivered job", () => {
  it("runs the archive and returns its result", async () => {
    archiveDeliveredShipments.mockResolvedValue({ archived: 4 });

    const { result } = await new InngestTestEngine({
      function: archiveDelivered,
    }).execute();

    expect(result).toEqual({ archived: 4 });
    expect(archiveDeliveredShipments.mock.calls[0]?.[0].db).toBe("db");
    expect(archiveDeliveredShipments.mock.calls[0]?.[0].expireAfterDays).toBe(
      45,
    );
  });

  it("is a daily cron job in UTC", () => {
    expect(archiveDelivered.opts.triggers).toEqual([
      { cron: "TZ=UTC 30 3 * * *" },
    ]);
    expect(archiveDelivered.opts.concurrency).toBe(1);
  });
});

describe("expireQuiet job", () => {
  it("expires with the configured number of days, daily before the archive", async () => {
    expireQuietShipments.mockResolvedValue({ expired: 2 });
    const { result } = await new InngestTestEngine({
      function: expireQuiet,
    }).execute();
    expect(result).toEqual({ expired: 2 });
    const args = expireQuietShipments.mock.calls[0]?.[0];
    expect(args.db).toBe("db");
    expect(args.expireAfterDays).toBe(45);
    expect(args.now).toBeInstanceOf(Date);
    expect(expireQuiet.opts.triggers).toEqual([{ cron: "TZ=UTC 20 3 * * *" }]);
    expect(expireQuiet.opts.concurrency).toBe(1);
  });
});

describe("rateLimitsCleanup job", () => {
  it("runs the cleanup daily and returns its result", async () => {
    cleanupRateLimits.mockResolvedValue({ deleted: 7 });
    const { result } = await new InngestTestEngine({
      function: rateLimitsCleanup,
    }).execute();
    expect(result).toEqual({ deleted: 7 });
    expect(cleanupRateLimits.mock.calls[0]?.[0].db).toBe("db");
    expect(rateLimitsCleanup.opts.triggers).toEqual([
      { cron: "TZ=UTC 0 4 * * *" },
    ]);
  });
});

describe("function list", () => {
  it("registers every job", () => {
    expect(functions).toEqual([
      refetchStale,
      refetchTrackerJob,
      archiveDelivered,
      expireQuiet,
      geocodeSweep,
      geocodePlaceJob,
      processEmailJob,
      emailSweep,
      emailCleanup,
      sendNotificationJob,
      notificationsSweep,
      notificationsCleanup,
      rateLimitsCleanup,
    ]);
  });
});
