// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from "vitest";

const { receiveInboundEmail, requestEmailProcessing, getEnv } = vi.hoisted(
  () => ({
    receiveInboundEmail: vi.fn(),
    requestEmailProcessing: vi.fn(),
    getEnv: vi.fn(),
  }),
);

vi.mock("@/lib/email/receive", () => ({ receiveInboundEmail }));
vi.mock("@/jobs/events", () => ({ requestEmailProcessing }));
vi.mock("@/lib/db/client", () => ({ getDb: () => "db" }));
vi.mock("@/lib/env", () => ({ getEnv }));

import { POST } from "./route";

const SECRET = "route-secret-value";
const request = (
  body = '{"subject":"private subject","text":"private body"}',
) =>
  new Request("http://localhost/api/webhooks/inbound-email", {
    method: "POST",
    headers: { authorization: `Bearer ${SECRET}` },
    body,
  });

beforeEach(() => {
  receiveInboundEmail.mockReset();
  requestEmailProcessing.mockReset();
  getEnv.mockReset();
  getEnv.mockReturnValue({
    INBOUND_WEBHOOK_SECRET: "configured-secret",
    INBOUND_EMAIL_DOMAIN: "in.example.test",
    INBOUND_DAILY_LIMIT: 25,
  });
  vi.spyOn(console, "info").mockImplementation(() => {});
  vi.spyOn(console, "error").mockImplementation(() => {});
});

describe("POST /api/webhooks/inbound-email", () => {
  it.each([
    [200, "stored"],
    [200, "unknown_alias"],
    [401, "unauthorized"],
    [413, "too_large"],
    [422, "invalid"],
  ] as const)(
    "passes %i (%s) through with an empty body",
    async (status, outcome) => {
      receiveInboundEmail.mockResolvedValue({ status, outcome });
      const response = await POST(request());
      expect(response.status).toBe(status);
      expect(await response.text()).toBe("");
    },
  );

  it("gives the receiver the raw body, the headers, the clock and the configuration", async () => {
    receiveInboundEmail.mockResolvedValue({ status: 200, outcome: "stored" });
    await POST(request('{"raw":  "spacing kept"}'));

    const args = receiveInboundEmail.mock.calls[0]?.[0];
    expect(args.rawBody).toBe('{"raw":  "spacing kept"}');
    expect(args.headers.get("authorization")).toBe(`Bearer ${SECRET}`);
    expect(args.db).toBe("db");
    expect(args.secret).toBe("configured-secret");
    expect(args.domain).toBe("in.example.test");
    expect(args.dailyLimit).toBe(25);
    expect(args.now).toBeInstanceOf(Date);
  });

  it("queues the stored email for reading, and only then", async () => {
    receiveInboundEmail.mockResolvedValueOnce({
      status: 200,
      outcome: "stored",
      emailId: "email-1",
    });
    await POST(request());
    expect(requestEmailProcessing).toHaveBeenCalledExactlyOnceWith("email-1");

    requestEmailProcessing.mockClear();
    for (const outcome of [
      { status: 200, outcome: "unknown_alias" },
      { status: 200, outcome: "duplicate" },
      { status: 200, outcome: "over_limit" },
      { status: 401, outcome: "unauthorized" },
      { status: 422, outcome: "invalid" },
    ]) {
      receiveInboundEmail.mockResolvedValueOnce(outcome);
      await POST(request());
    }
    expect(requestEmailProcessing).not.toHaveBeenCalled();
  });

  it("answers 500 when storing fails, so the Worker can retry", async () => {
    receiveInboundEmail.mockRejectedValue(new Error(`boom ${SECRET}`));
    expect((await POST(request())).status).toBe(500);
    expect(requestEmailProcessing).not.toHaveBeenCalled();
  });

  it("answers 500 when the configuration is invalid", async () => {
    getEnv.mockImplementation(() => {
      throw new Error("Invalid environment: missing INBOUND_WEBHOOK_SECRET");
    });
    expect((await POST(request())).status).toBe(500);
    expect(receiveInboundEmail).not.toHaveBeenCalled();
  });

  it("answers 500 even when something that is not an Error is thrown", async () => {
    receiveInboundEmail.mockRejectedValue("bare string");
    expect((await POST(request())).status).toBe(500);
  });

  it("logs only the outcome: never the body, subject, headers, secrets or error text", async () => {
    receiveInboundEmail.mockResolvedValueOnce({
      status: 200,
      outcome: "stored",
      emailId: "e",
    });
    await POST(request());
    receiveInboundEmail.mockRejectedValueOnce(
      new Error(`boom ${SECRET} private body`),
    );
    await POST(request());

    const logged = JSON.stringify([
      ...vi.mocked(console.info).mock.calls,
      ...vi.mocked(console.error).mock.calls,
    ]);
    for (const secret of [
      SECRET,
      "configured-secret",
      "private subject",
      "private body",
      "boom",
    ]) {
      expect(logged).not.toContain(secret);
    }
    expect(logged).toContain("stored");
  });
});
