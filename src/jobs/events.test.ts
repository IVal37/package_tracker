// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { send } = vi.hoisted(() => ({ send: vi.fn() }));
vi.mock("./client", () => ({ inngest: { send } }));

import {
  requestEmailProcessing,
  requestGeocoding,
  requestNotifications,
} from "./events";

beforeEach(() => {
  send.mockReset();
  vi.spyOn(console, "warn").mockImplementation(() => {});
});

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe("requestGeocoding", () => {
  it("sends the geocode.requested event", async () => {
    send.mockResolvedValue({ ids: ["x"] });
    await requestGeocoding();
    expect(send).toHaveBeenCalledExactlyOnceWith({
      name: "wayfind/geocode.requested",
    });
  });

  it("never throws when sending fails, and logs only the error name", async () => {
    send.mockRejectedValue(new TypeError("connect ECONNREFUSED secret-host"));

    await expect(requestGeocoding()).resolves.toBeUndefined();

    const logged = JSON.stringify(vi.mocked(console.warn).mock.calls);
    expect(logged).toContain("TypeError");
    expect(logged).not.toContain("secret-host");
  });

  it("gives up after two seconds instead of holding up its caller", async () => {
    vi.useFakeTimers();
    send.mockReturnValue(new Promise(() => {})); // never settles

    const done = requestGeocoding();
    await vi.advanceTimersByTimeAsync(2000);

    await expect(done).resolves.toBeUndefined();
    expect(console.warn).toHaveBeenCalledOnce();
  });
});

describe("requestEmailProcessing", () => {
  it("sends the email.received event with the id, once per email", async () => {
    send.mockResolvedValue({ ids: ["x"] });
    await requestEmailProcessing("abc-123");
    expect(send).toHaveBeenCalledExactlyOnceWith({
      name: "wayfind/email.received",
      id: "email-abc-123",
      data: { emailId: "abc-123" },
    });
  });

  it("never throws when sending fails, and logs only the error name", async () => {
    send.mockRejectedValue(new TypeError("connect ECONNREFUSED secret-host"));

    await expect(requestEmailProcessing("abc")).resolves.toBeUndefined();

    const logged = JSON.stringify(vi.mocked(console.warn).mock.calls);
    expect(logged).toContain("email processing request not sent");
    expect(logged).toContain("TypeError");
    expect(logged).not.toContain("secret-host");
  });

  it("gives up after two seconds instead of holding up the webhook", async () => {
    vi.useFakeTimers();
    send.mockReturnValue(new Promise(() => {}));

    const done = requestEmailProcessing("abc");
    await vi.advanceTimersByTimeAsync(2000);

    await expect(done).resolves.toBeUndefined();
    expect(console.warn).toHaveBeenCalledOnce();
  });
});

describe("requestNotifications", () => {
  const ID_A = "11111111-1111-4111-8111-111111111111";
  const ID_B = "22222222-2222-4222-8222-222222222222";

  it("sends one event per alert, with ids that make a repeat harmless", async () => {
    send.mockResolvedValue({ ids: ["x"] });
    await requestNotifications([ID_A, ID_B]);
    expect(send).toHaveBeenCalledExactlyOnceWith([
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
    ]);
  });

  it("sends nothing for no alerts", async () => {
    await requestNotifications([]);
    expect(send).not.toHaveBeenCalled();
  });

  it("never throws when sending fails, and logs only the error name", async () => {
    send.mockRejectedValue(new TypeError("connect ECONNREFUSED secret-host"));
    await expect(requestNotifications([ID_A])).resolves.toBeUndefined();
    const logged = JSON.stringify(vi.mocked(console.warn).mock.calls);
    expect(logged).toContain("TypeError");
    expect(logged).not.toContain("secret-host");
    expect(logged).not.toContain(ID_A);
  });
});
