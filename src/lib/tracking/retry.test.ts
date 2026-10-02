import { describe, expect, it, vi } from "vitest";
import {
  InvalidTrackingNumberError,
  ProviderAuthError,
  ProviderUnavailableError,
  QuotaExceededError,
  RateLimitedError,
  TrackerNotFoundError,
} from "./errors";
import { withRetry } from "./retry";

const noSleep = () => vi.fn<(ms: number) => Promise<void>>(async () => {});

describe("withRetry", () => {
  it("returns the result without sleeping when the first call succeeds", async () => {
    const sleep = noSleep();
    const fn = vi.fn().mockResolvedValue("ok");
    await expect(withRetry(fn, { sleep })).resolves.toBe("ok");
    expect(fn).toHaveBeenCalledTimes(1);
    expect(sleep).not.toHaveBeenCalled();
  });

  it("succeeds on the 2nd try after a retryable error", async () => {
    const fn = vi
      .fn()
      .mockRejectedValueOnce(new RateLimitedError())
      .mockResolvedValueOnce("ok");
    await expect(withRetry(fn, { sleep: noSleep() })).resolves.toBe("ok");
    expect(fn).toHaveBeenCalledTimes(2);
  });

  it("gives up after the retry cap and rethrows the last error", async () => {
    const sleep = noSleep();
    const fn = vi.fn().mockRejectedValue(new ProviderUnavailableError());
    await expect(withRetry(fn, { retries: 2, sleep })).rejects.toBeInstanceOf(
      ProviderUnavailableError,
    );
    expect(fn).toHaveBeenCalledTimes(3);
    expect(sleep).toHaveBeenCalledTimes(2);
  });

  it.each([
    new ProviderAuthError("401"),
    new InvalidTrackingNumberError("400"),
    new QuotaExceededError("403"),
    new TrackerNotFoundError("404"),
    new Error("not a provider error"),
  ])("never retries %s", async (error) => {
    const fn = vi.fn().mockRejectedValue(error);
    await expect(withRetry(fn, { sleep: noSleep() })).rejects.toBe(error);
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it("backs off exponentially with jitter, capped at maxMs", async () => {
    const sleep = noSleep();
    const fn = vi.fn().mockRejectedValue(new RateLimitedError());
    await expect(
      withRetry(fn, {
        retries: 5,
        baseMs: 100,
        maxMs: 500,
        sleep,
        random: () => 0.999,
      }),
    ).rejects.toBeInstanceOf(RateLimitedError);

    const delays = sleep.mock.calls.map(([ms]) => ms);
    // ceilings: 100, 200, 400, 500 (capped), 500 (capped); jitter just below 1
    expect(delays).toEqual([99, 199, 399, 499, 499]);
  });

  it("applies full jitter: a delay can be as low as zero", async () => {
    const sleep = noSleep();
    const fn = vi
      .fn()
      .mockRejectedValueOnce(new RateLimitedError())
      .mockResolvedValueOnce("ok");
    await withRetry(fn, { sleep, random: () => 0 });
    expect(sleep).toHaveBeenCalledWith(0);
  });

  it("uses real timers by default", async () => {
    vi.useFakeTimers();
    try {
      const fn = vi
        .fn()
        .mockRejectedValueOnce(new RateLimitedError())
        .mockResolvedValueOnce("ok");
      const promise = withRetry(fn, { baseMs: 10, random: () => 0.5 });
      await vi.advanceTimersByTimeAsync(10);
      await expect(promise).resolves.toBe("ok");
    } finally {
      vi.useRealTimers();
    }
  });
});
