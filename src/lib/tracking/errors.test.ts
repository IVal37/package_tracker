import { describe, expect, it } from "vitest";
import {
  InvalidTrackingNumberError,
  ProviderAuthError,
  ProviderResponseError,
  ProviderUnavailableError,
  QuotaExceededError,
  RateLimitedError,
  RequestConflictError,
  TrackerConflictError,
  TrackerNotFoundError,
  TrackingProviderError,
  WebhookAuthError,
} from "./errors";

describe("tracking errors", () => {
  it.each([
    [new RateLimitedError(), true],
    [new ProviderUnavailableError(), true],
    [new RequestConflictError(), true],
    [new ProviderAuthError("x"), false],
    [new InvalidTrackingNumberError("x"), false],
    [new QuotaExceededError("x"), false],
    [new TrackerNotFoundError("x"), false],
    [new TrackerConflictError("x"), false],
    [new ProviderResponseError("x"), false],
    [new WebhookAuthError("x"), false],
  ])("%o has retryable=%s", (error, retryable) => {
    expect(error.retryable).toBe(retryable);
  });

  it("sets name to the subclass and extends TrackingProviderError", () => {
    const error = new TrackerNotFoundError("missing");
    expect(error).toBeInstanceOf(TrackingProviderError);
    expect(error).toBeInstanceOf(Error);
    expect(error.name).toBe("TrackerNotFoundError");
    expect(error.message).toBe("missing");
  });
});
