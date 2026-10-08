// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { send } = vi.hoisted(() => ({ send: vi.fn() }));
vi.mock("./client", () => ({ inngest: { send } }));

import { requestGeocoding } from "./events";

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
