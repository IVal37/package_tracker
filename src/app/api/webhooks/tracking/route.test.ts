// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from "vitest";

const { handleTrackingWebhook } = vi.hoisted(() => ({
  handleTrackingWebhook: vi.fn(),
}));

vi.mock("@/lib/shipments/sync/handle-webhook", () => ({
  handleTrackingWebhook,
}));
const { requestGeocoding, requestNotifications } = vi.hoisted(() => ({
  requestGeocoding: vi.fn(),
  requestNotifications: vi.fn(),
}));
vi.mock("@/jobs/events", () => ({ requestGeocoding, requestNotifications }));
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
  requestNotifications.mockReset();
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

describe("POST /api/webhooks/tracking: notifications", () => {
  const ID_A = "11111111-1111-4111-8111-111111111111";
  const ID_B = "22222222-2222-4222-8222-222222222222";

  it("asks for the recorded alerts to be delivered", async () => {
    handleTrackingWebhook.mockResolvedValueOnce({
      status: 200,
      applied: 2,
      newCheckpoints: 0,
      notificationIds: [ID_A, ID_B],
    });
    const response = await POST(request());
    expect(response.status).toBe(200);
    expect(requestNotifications).toHaveBeenCalledExactlyOnceWith([ID_A, ID_B]);
  });

  it("does not let a failed send change the answer", async () => {
    handleTrackingWebhook.mockResolvedValueOnce({
      status: 200,
      applied: 1,
      newCheckpoints: 1,
      notificationIds: [ID_A],
    });
    requestNotifications.mockResolvedValueOnce(undefined);
    expect((await POST(request())).status).toBe(200);
  });

  it("passes an empty list on when the webhook was rejected", async () => {
    handleTrackingWebhook.mockResolvedValueOnce({
      status: 401,
      applied: 0,
      newCheckpoints: 0,
      notificationIds: [],
    });
    await POST(request());
    expect(requestNotifications).toHaveBeenCalledWith([]);
  });

  it("never logs alert ids", async () => {
    handleTrackingWebhook.mockResolvedValueOnce({
      status: 200,
      applied: 1,
      newCheckpoints: 1,
      notificationIds: [ID_A],
    });
    await POST(request());
    const logged = JSON.stringify(vi.mocked(console.info).mock.calls);
    expect(logged).not.toContain(ID_A);
  });
});
