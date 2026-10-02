// Typed provider errors. Messages must never contain API keys or webhook secrets.

export class TrackingProviderError extends Error {
  readonly retryable: boolean;

  constructor(message: string, options: { retryable?: boolean } = {}) {
    super(message);
    this.name = new.target.name;
    this.retryable = options.retryable ?? false;
  }
}

export class ProviderAuthError extends TrackingProviderError {}
export class InvalidTrackingNumberError extends TrackingProviderError {}
export class QuotaExceededError extends TrackingProviderError {}
export class TrackerNotFoundError extends TrackingProviderError {}
/** The provider reports this tracker already exists with different parameters. */
export class TrackerConflictError extends TrackingProviderError {}
export class ProviderResponseError extends TrackingProviderError {}
export class WebhookAuthError extends TrackingProviderError {}

export class RateLimitedError extends TrackingProviderError {
  constructor(message = "Rate limited by tracking provider") {
    super(message, { retryable: true });
  }
}

export class ProviderUnavailableError extends TrackingProviderError {
  constructor(message = "Tracking provider unavailable") {
    super(message, { retryable: true });
  }
}

/** Concurrent identical request collision; safe to retry. */
export class RequestConflictError extends TrackingProviderError {
  constructor(message = "Concurrent request conflict") {
    super(message, { retryable: true });
  }
}
