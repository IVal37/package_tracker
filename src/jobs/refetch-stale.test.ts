// @vitest-environment node
import { InngestTestEngine } from "@inngest/test";
import { beforeEach, describe, expect, it, vi } from "vitest";

const { findTrackersToRefetch, refetchTracker, reportIssue } = vi.hoisted(
  () => ({
    findTrackersToRefetch: vi.fn(),
    refetchTracker: vi.fn(),
    reportIssue: vi.fn(),
  }),
);

vi.mock("@/lib/monitoring", () => ({ reportIssue }));

vi.mock("@/lib/shipments/sync/refetch-stale", async (importOriginal) => ({
  ...(await importOriginal<
    typeof import("@/lib/shipments/sync/refetch-stale")
  >()),
  findTrackersToRefetch,
  refetchTracker,
}));
vi.mock("@/lib/db/client", () => ({ getDb: () => "db" }));
vi.mock("@/lib/tracking", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/tracking")>()),
  getTrackingProvider: () => "provider",
}));

import { refetchStale, refetchTrackerJob } from "./refetch-stale";

const ID_A = "11111111-1111-4111-8111-111111111111";
const ID_B = "22222222-2222-4222-8222-222222222222";

beforeEach(() => {
  findTrackersToRefetch.mockReset();
  refetchTracker.mockReset();
  reportIssue.mockReset();
});

const runTracker = (trackerId = "fake:T1") =>
  new InngestTestEngine({ function: refetchTrackerJob }).execute({
    events: [{ name: "wayfind/tracker.refetch", data: { trackerId } }],
    steps: [
      { id: "request-geocoding", handler: () => ({ ids: [] }) },
      { id: "request-notifications", handler: () => ({ ids: [] }) },
    ],
  });

describe("refetchStale sweep", () => {
  it("queues one event per stale tracker, with an id per tracker per hour", async () => {
    findTrackersToRefetch.mockResolvedValue(["fake:A", "fake:B"]);

    const { result, ctx } = await new InngestTestEngine({
      function: refetchStale,
    }).execute({
      steps: [{ id: "queue-trackers", handler: () => ({ ids: [] }) }],
    });

    expect(result).toEqual({ queued: 2 });
    const args = findTrackersToRefetch.mock.calls[0]?.[0];
    expect(args.db).toBe("db");
    expect(args.provider).toBe("provider");
    expect(args.limit).toBe(500);
    const [, events] = vi.mocked(ctx.step.sendEvent).mock.calls[0]!;
    expect(events).toEqual([
      {
        id: expect.stringMatching(/^refetch-fake:A-\d+$/),
        name: "wayfind/tracker.refetch",
        data: { trackerId: "fake:A" },
      },
      {
        id: expect.stringMatching(/^refetch-fake:B-\d+$/),
        name: "wayfind/tracker.refetch",
        data: { trackerId: "fake:B" },
      },
    ]);
  });

  it("sends nothing when nothing is stale", async () => {
    findTrackersToRefetch.mockResolvedValue([]);
    const { result, ctx } = await new InngestTestEngine({
      function: refetchStale,
    }).execute();
    expect(result).toEqual({ queued: 0 });
    expect(ctx.step.sendEvent).not.toHaveBeenCalled();
  });

  it("is an hourly cron job that runs once at a time", () => {
    expect(refetchStale.opts.triggers).toEqual([{ cron: "0 * * * *" }]);
    expect(refetchStale.opts.concurrency).toBe(1);
  });
});

describe("refetchTracker job", () => {
  it("re-fetches the one tracker it was given", async () => {
    refetchTracker.mockResolvedValue({
      outcome: "unchanged",
      newCheckpoints: 0,
      notificationIds: [],
    });

    const { result, ctx } = await runTracker("fake:ONE");

    expect(result).toEqual({
      outcome: "unchanged",
      newCheckpoints: 0,
      notificationIds: [],
    });
    const args = refetchTracker.mock.calls[0]?.[0];
    expect(args.trackerId).toBe("fake:ONE");
    expect(args.db).toBe("db");
    expect(args.provider).toBe("provider");
    expect(ctx.step.sendEvent).not.toHaveBeenCalled();
  });

  it("asks for geocoding and delivers alerts after an update", async () => {
    refetchTracker.mockResolvedValue({
      outcome: "updated",
      newCheckpoints: 2,
      notificationIds: [ID_A, ID_B],
    });

    const { ctx } = await runTracker();

    const calls = vi.mocked(ctx.step.sendEvent).mock.calls;
    expect(calls[0]).toEqual([
      "request-geocoding",
      {
        name: "wayfind/geocode.requested",
        id: expect.stringMatching(/^geocode-after-refetch-\d+$/),
      },
    ]);
    expect(calls[1]).toEqual([
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
    ]);
  });

  it.each([
    { outcome: "failed" },
    { outcome: "paused" },
    { outcome: "stopped", reason: "quota", firstReport: false },
  ])("sends nothing for $outcome", async (outcome) => {
    refetchTracker.mockResolvedValue(outcome);
    const { result, ctx } = await runTracker();
    expect(result).toEqual(outcome);
    expect(ctx.step.sendEvent).not.toHaveBeenCalled();
  });

  it("reports a stopped re-fetch once: only from the run that tripped the pause", async () => {
    refetchTracker.mockResolvedValue({
      outcome: "stopped",
      reason: "auth",
      firstReport: true,
    });
    await runTracker("fake:A");
    refetchTracker.mockResolvedValue({
      outcome: "stopped",
      reason: "auth",
      firstReport: false,
    });
    await runTracker("fake:B");
    refetchTracker.mockResolvedValue({ outcome: "paused" });
    await runTracker("fake:C");

    expect(reportIssue).toHaveBeenCalledExactlyOnceWith("refetch_stopped", {
      reason: "auth",
    });
  });

  it("rejects an invalid event without retrying", async () => {
    const { error } = await new InngestTestEngine({
      function: refetchTrackerJob,
    }).execute({
      events: [{ name: "wayfind/tracker.refetch", data: { trackerId: "" } }],
    });
    expect(error).toMatchObject({ message: "Invalid refetch event" });
    expect(refetchTracker).not.toHaveBeenCalled();
  });

  it("is throttled and runs a few at a time", () => {
    expect(refetchTrackerJob.opts.triggers).toEqual([
      { event: "wayfind/tracker.refetch" },
    ]);
    expect(refetchTrackerJob.opts.concurrency).toEqual({ limit: 5 });
    expect(refetchTrackerJob.opts.throttle).toEqual({
      limit: 2,
      period: "1s",
    });
  });
});
