// @vitest-environment node
import { InngestTestEngine } from "@inngest/test";
import { beforeEach, describe, expect, it, vi } from "vitest";

const { refetchStaleShipments, archiveDeliveredShipments } = vi.hoisted(() => ({
  refetchStaleShipments: vi.fn(),
  archiveDeliveredShipments: vi.fn(),
}));

vi.mock("@/lib/shipments/sync/refetch-stale", () => ({
  refetchStaleShipments,
}));
vi.mock("@/lib/shipments/sync/archive-delivered", () => ({
  archiveDeliveredShipments,
}));
vi.mock("@/lib/db/client", () => ({ getDb: () => "db" }));
vi.mock("@/lib/tracking", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/tracking")>()),
  getTrackingProvider: () => "provider",
}));

import { archiveDelivered } from "./archive-delivered";
import { geocodePlaceJob, geocodeSweep } from "./geocode";
import { emailCleanup, emailSweep, processEmailJob } from "./inbound-email";
import { functions } from "./index";
import {
  notificationsCleanup,
  notificationsSweep,
  sendNotificationJob,
} from "./notifications";
import { refetchStale } from "./refetch-stale";

beforeEach(() => {
  refetchStaleShipments.mockReset();
  archiveDeliveredShipments.mockReset();
});

describe("refetchStale job: notifications", () => {
  const ID_A = "11111111-1111-4111-8111-111111111111";
  const ID_B = "22222222-2222-4222-8222-222222222222";

  it("sends one event per alert recorded by the updates", async () => {
    refetchStaleShipments.mockResolvedValue({
      checked: 2,
      updated: 0,
      failed: 0,
      stoppedEarly: false,
      notificationIds: [ID_A, ID_B],
    });

    const { ctx } = await new InngestTestEngine({
      function: refetchStale,
    }).execute({
      steps: [{ id: "request-notifications", handler: () => ({ ids: [] }) }],
    });

    expect(ctx.step.sendEvent).toHaveBeenCalledExactlyOnceWith(
      "request-notifications",
      [
        {
          id: `notification-${ID_A}`,
          name: "wayfind/notification.created",
          data: { notificationId: ID_A },
        },
        {
          id: `notification-${ID_B}`,
          name: "wayfind/notification.created",
          data: { notificationId: ID_B },
        },
      ],
    );
  });

  it("sends none when no alert was recorded", async () => {
    refetchStaleShipments.mockResolvedValue({
      checked: 2,
      updated: 0,
      failed: 0,
      stoppedEarly: false,
      notificationIds: [],
    });
    const { ctx } = await new InngestTestEngine({
      function: refetchStale,
    }).execute();
    expect(ctx.step.sendEvent).not.toHaveBeenCalled();
  });
});

describe("refetchStale job", () => {
  it("runs the re-fetch with the real db and provider and returns its result", async () => {
    const summary = {
      checked: 3,
      updated: 2,
      failed: 1,
      stoppedEarly: false,
      notificationIds: [],
    };
    refetchStaleShipments.mockResolvedValue(summary);

    const { result } = await new InngestTestEngine({
      function: refetchStale,
    }).execute({
      steps: [{ id: "request-geocoding", handler: () => ({ ids: [] }) }],
    });

    expect(result).toEqual(summary);
    const args = refetchStaleShipments.mock.calls[0]?.[0];
    expect(args.db).toBe("db");
    expect(args.provider).toBe("provider");
    expect(args.now).toBeInstanceOf(Date);
    expect(args.limit).toBe(100);
  });

  it("asks for geocoding when the re-fetch brought something new", async () => {
    refetchStaleShipments.mockResolvedValue({
      checked: 1,
      updated: 1,
      failed: 0,
      stoppedEarly: false,
      notificationIds: [],
    });

    const { ctx } = await new InngestTestEngine({
      function: refetchStale,
    }).execute({
      steps: [{ id: "request-geocoding", handler: () => ({ ids: [] }) }],
    });

    expect(ctx.step.sendEvent).toHaveBeenCalledExactlyOnceWith(
      "request-geocoding",
      { name: "wayfind/geocode.requested" },
    );
  });

  it("does not ask for geocoding when nothing changed", async () => {
    refetchStaleShipments.mockResolvedValue({
      checked: 4,
      updated: 0,
      failed: 1,
      stoppedEarly: false,
      notificationIds: [],
    });

    const { ctx } = await new InngestTestEngine({
      function: refetchStale,
    }).execute();

    expect(ctx.step.sendEvent).not.toHaveBeenCalled();
  });

  it("is an hourly cron job", () => {
    expect(refetchStale.opts.triggers).toEqual([{ cron: "0 * * * *" }]);
    expect(refetchStale.opts.concurrency).toBe(1);
  });
});

describe("archiveDelivered job", () => {
  it("runs the archive and returns its result", async () => {
    archiveDeliveredShipments.mockResolvedValue({ archived: 4 });

    const { result } = await new InngestTestEngine({
      function: archiveDelivered,
    }).execute();

    expect(result).toEqual({ archived: 4 });
    expect(archiveDeliveredShipments.mock.calls[0]?.[0].db).toBe("db");
  });

  it("is a daily cron job in UTC", () => {
    expect(archiveDelivered.opts.triggers).toEqual([
      { cron: "TZ=UTC 30 3 * * *" },
    ]);
    expect(archiveDelivered.opts.concurrency).toBe(1);
  });
});

describe("function list", () => {
  it("registers every job", () => {
    expect(functions).toEqual([
      refetchStale,
      archiveDelivered,
      geocodeSweep,
      geocodePlaceJob,
      processEmailJob,
      emailSweep,
      emailCleanup,
      sendNotificationJob,
      notificationsSweep,
      notificationsCleanup,
    ]);
  });
});
