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
vi.mock("@/lib/tracking", () => ({ getTrackingProvider: () => "provider" }));

import { archiveDelivered } from "./archive-delivered";
import { functions } from "./index";
import { refetchStale } from "./refetch-stale";

beforeEach(() => {
  refetchStaleShipments.mockReset();
  archiveDeliveredShipments.mockReset();
});

describe("refetchStale job", () => {
  it("runs the re-fetch with the real db and provider and returns its result", async () => {
    const summary = { checked: 3, updated: 2, failed: 1, stoppedEarly: false };
    refetchStaleShipments.mockResolvedValue(summary);

    const { result } = await new InngestTestEngine({
      function: refetchStale,
    }).execute();

    expect(result).toEqual(summary);
    const args = refetchStaleShipments.mock.calls[0]?.[0];
    expect(args.db).toBe("db");
    expect(args.provider).toBe("provider");
    expect(args.now).toBeInstanceOf(Date);
    expect(args.limit).toBe(100);
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
  it("registers both jobs", () => {
    expect(functions).toEqual([refetchStale, archiveDelivered]);
  });
});
