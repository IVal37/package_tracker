// @vitest-environment node
import { InngestTestEngine } from "@inngest/test";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  processInboundEmail: vi.fn(),
  markInboundEmailFailed: vi.fn(),
  cleanupInboundData: vi.fn(),
  findStuckEmailIds: vi.fn(),
}));

vi.mock("@/lib/db/client", () => ({ getDb: () => "db" }));
vi.mock("@/lib/tracking", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/tracking")>()),
  getTrackingProvider: () => "provider",
}));
vi.mock("@/lib/email/extract", () => ({ getExtractor: () => "extractor" }));
vi.mock("@/lib/email/cleanup", () => ({
  cleanupInboundData: mocks.cleanupInboundData,
  findStuckEmailIds: mocks.findStuckEmailIds,
}));
vi.mock("@/lib/email/process", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/email/process")>()),
  processInboundEmail: mocks.processInboundEmail,
  markInboundEmailFailed: mocks.markInboundEmailFailed,
}));

import { ProcessingRetryError } from "@/lib/email/process";
import { emailCleanup, emailSweep, processEmailJob } from "./inbound-email";

beforeEach(() => {
  for (const mock of Object.values(mocks)) mock.mockReset();
});

const event = (data: unknown) => ({
  name: "wayfind/email.received",
  data: data as never,
});
const geocodeStep = { id: "request-geocoding", handler: () => ({ ids: [] }) };

describe("process-inbound-email", () => {
  it("is triggered by the email.received event, one run per email, with retries", () => {
    expect(processEmailJob.opts.triggers).toEqual([
      { event: "wayfind/email.received" },
    ]);
    expect(processEmailJob.opts.concurrency).toEqual({
      limit: 1,
      key: "event.data.emailId",
    });
    expect(processEmailJob.opts.retries).toBe(3);
  });

  it("processes the email with the real database, provider and extractor", async () => {
    mocks.processInboundEmail.mockResolvedValue({
      status: "parsed",
      created: 0,
    });

    const { result } = await new InngestTestEngine({
      function: processEmailJob,
    }).execute({
      events: [event({ emailId: "email-1" })],
    });

    expect(result).toEqual({ status: "parsed", created: 0 });
    expect(mocks.processInboundEmail).toHaveBeenCalledExactlyOnceWith({
      db: "db",
      provider: "provider",
      extractor: "extractor",
      emailId: "email-1",
    });
  });

  it("asks for geocoding when it created packages, and not otherwise", async () => {
    mocks.processInboundEmail.mockResolvedValue({
      status: "parsed",
      created: 2,
    });
    const created = await new InngestTestEngine({
      function: processEmailJob,
    }).execute({
      events: [event({ emailId: "e" })],
      steps: [geocodeStep],
    });
    expect(created.ctx.step.sendEvent).toHaveBeenCalledExactlyOnceWith(
      "request-geocoding",
      {
        name: "wayfind/geocode.requested",
      },
    );

    mocks.processInboundEmail.mockResolvedValue({
      status: "parsed",
      created: 0,
    });
    const none = await new InngestTestEngine({
      function: processEmailJob,
    }).execute({
      events: [event({ emailId: "e" })],
    });
    expect(none.ctx.step.sendEvent).not.toHaveBeenCalled();
  });

  it.each([{}, { emailId: "" }, { emailId: 7 }, null])(
    "refuses an event with data %j, without retrying",
    async (data) => {
      const { error } = await new InngestTestEngine({
        function: processEmailJob,
      }).execute({
        events: [event(data)],
      });
      expect(error).toMatchObject({
        name: "NonRetriableError",
        message: "Invalid email event",
      });
      expect(mocks.processInboundEmail).not.toHaveBeenCalled();
    },
  );

  it("lets a temporary problem through so Inngest retries, leaving the email pending", async () => {
    mocks.processInboundEmail.mockRejectedValue(
      new ProcessingRetryError("provider down"),
    );

    const { error } = await new InngestTestEngine({
      function: processEmailJob,
    }).execute({
      events: [event({ emailId: "e" })],
    });

    expect(error).toBeDefined();
    expect(mocks.markInboundEmailFailed).not.toHaveBeenCalled();
  });

  it("on the last attempt, marks the email failed instead of leaving it pending forever", async () => {
    mocks.processInboundEmail.mockRejectedValue(
      new ProcessingRetryError("provider down"),
    );

    const { result, error } = await new InngestTestEngine({
      function: processEmailJob,
      transformCtx: (ctx) => ({ ...ctx, attempt: 3, maxAttempts: 4 }),
    }).execute({ events: [event({ emailId: "email-9" })] });

    expect(error).toBeUndefined();
    expect(result).toEqual({ status: "failed", created: 0 });
    expect(mocks.markInboundEmailFailed).toHaveBeenCalledExactlyOnceWith(
      "db",
      "email-9",
      "provider down",
    );
  });

  it("does not hide a bug on the last attempt", async () => {
    mocks.processInboundEmail.mockRejectedValue(new TypeError("bug"));

    const { error } = await new InngestTestEngine({
      function: processEmailJob,
      transformCtx: (ctx) => ({ ...ctx, attempt: 3, maxAttempts: 4 }),
    }).execute({ events: [event({ emailId: "e" })] });

    expect(error).toBeDefined();
    expect(mocks.markInboundEmailFailed).not.toHaveBeenCalled();
  });
});

describe("inbound-email-sweep", () => {
  it("runs hourly, one at a time", () => {
    expect(emailSweep.opts.triggers).toEqual([{ cron: "20 * * * *" }]);
    expect(emailSweep.opts.concurrency).toBe(1);
  });

  it("re-queues stuck emails with ids that are new each hour", async () => {
    mocks.findStuckEmailIds.mockResolvedValue(["a", "b"]);

    const { result, ctx } = await new InngestTestEngine({
      function: emailSweep,
    }).execute({
      steps: [{ id: "queue-emails", handler: () => ({ ids: [] }) }],
    });

    expect(result).toEqual({ queued: 2 });
    expect(mocks.findStuckEmailIds).toHaveBeenCalledWith(
      expect.objectContaining({ db: "db", limit: 100 }),
    );
    expect(ctx.step.sendEvent).toHaveBeenCalledWith("queue-emails", [
      expect.objectContaining({
        name: "wayfind/email.received",
        data: { emailId: "a" },
        id: expect.stringMatching(/^email-a-sweep-\d+$/),
      }),
      expect.objectContaining({ data: { emailId: "b" } }),
    ]);
  });

  it("sends nothing when no email is stuck", async () => {
    mocks.findStuckEmailIds.mockResolvedValue([]);
    const { result, ctx } = await new InngestTestEngine({
      function: emailSweep,
    }).execute();
    expect(result).toEqual({ queued: 0 });
    expect(ctx.step.sendEvent).not.toHaveBeenCalled();
  });
});

describe("inbound-email-cleanup", () => {
  it("runs daily at 03:40 UTC, one at a time", () => {
    expect(emailCleanup.opts.triggers).toEqual([{ cron: "TZ=UTC 40 3 * * *" }]);
    expect(emailCleanup.opts.concurrency).toBe(1);
  });

  it("deletes old emails and orders and returns the counts", async () => {
    mocks.cleanupInboundData.mockResolvedValue({ emails: 3, orders: 1 });
    const { result } = await new InngestTestEngine({
      function: emailCleanup,
    }).execute();
    expect(result).toEqual({ emails: 3, orders: 1 });
    expect(mocks.cleanupInboundData).toHaveBeenCalledWith(
      expect.objectContaining({ db: "db", now: expect.any(Date) }),
    );
  });
});
