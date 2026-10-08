// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from "vitest";

const { handleTrackingWebhook } = vi.hoisted(() => ({
  handleTrackingWebhook: vi.fn(),
}));

vi.mock("@/lib/shipments/sync/handle-webhook", () => ({
  handleTrackingWebhook,
}));
const { requestGeocoding } = vi.hoisted(() => ({ requestGeocoding: vi.fn() }));
vi.mock("@/jobs/events", () => ({ requestGeocoding }));
vi.mock("@/lib/db/client", () => ({ getDb: () => "db" }));
vi.mock("@/lib/tracking", () => ({ getTrackingProvider: () => "provider" }));

import { POST } from "./route";

const SECRET = "super-secret-token";
const request = (body = '{"private":"payload"}') =>
  new Request("http://localhost/api/webhooks/tracking", {
    method: "POST",
    headers: { authorization: `Bearer ${SECRET}` },
    body,
  });

beforeEach(() => {
  handleTrackingWebhook.mockReset();
  requestGeocoding.mockReset();
  vi.spyOn(console, "info").mockImplementation(() => {});
  vi.spyOn(console, "error").mockImplementation(() => {});
});

describe("POST /api/webhooks/tracking", () => {
  it.each([200, 401, 422] as const)(
    "passes the %s from the handler through with an empty body",
    async (status) => {
      handleTrackingWebhook.mockResolvedValue({
        status,
        applied: 0,
        newCheckpoints: 0,
      });
      const response = await POST(request());
      expect(response.status).toBe(status);
      expect(await response.text()).toBe("");
    },
  );

  it("hands the handler the raw body, the headers and the injected db/provider", async () => {
    handleTrackingWebhook.mockResolvedValue({
      status: 200,
      applied: 1,
      newCheckpoints: 1,
    });
    await POST(request('{"raw":  "spacing kept"}'));

    const args = handleTrackingWebhook.mock.calls[0]?.[0];
    expect(args.rawBody).toBe('{"raw":  "spacing kept"}');
    expect(args.headers.get("authorization")).toBe(`Bearer ${SECRET}`);
    expect(args.db).toBe("db");
    expect(args.provider).toBe("provider");
    expect(args.now).toBeInstanceOf(Date);
  });

  it("asks for geocoding only when the webhook brought new checkpoints", async () => {
    handleTrackingWebhook.mockResolvedValueOnce({
      status: 200,
      applied: 1,
      newCheckpoints: 2,
    });
    await POST(request());
    expect(requestGeocoding).toHaveBeenCalledOnce();

    requestGeocoding.mockClear();
    for (const outcome of [
      { status: 200, applied: 1, newCheckpoints: 0 },
      { status: 200, applied: 0, newCheckpoints: 0 },
      { status: 401, applied: 0, newCheckpoints: 0 },
      { status: 422, applied: 0, newCheckpoints: 0 },
    ]) {
      handleTrackingWebhook.mockResolvedValueOnce(outcome);
      await POST(request());
    }
    expect(requestGeocoding).not.toHaveBeenCalled();
  });

  it("answers 500 when the handler throws, so the provider retries", async () => {
    handleTrackingWebhook.mockRejectedValue(new Error(`boom ${SECRET}`));
    const response = await POST(request());
    expect(response.status).toBe(500);
  });

  it("answers 500 even when something that is not an Error is thrown", async () => {
    handleTrackingWebhook.mockRejectedValue("a bare string");
    expect((await POST(request())).status).toBe(500);
  });

  it("never logs the body, headers, secret or error message", async () => {
    handleTrackingWebhook.mockRejectedValueOnce(new Error(`boom ${SECRET}`));
    await POST(request());
    handleTrackingWebhook.mockResolvedValueOnce({
      status: 200,
      applied: 1,
      newCheckpoints: 1,
    });
    await POST(request());

    const logged = JSON.stringify([
      ...vi.mocked(console.info).mock.calls,
      ...vi.mocked(console.error).mock.calls,
    ]);
    expect(logged).not.toContain(SECRET);
    expect(logged).not.toContain("private");
    expect(logged).not.toContain("boom");
  });
});
