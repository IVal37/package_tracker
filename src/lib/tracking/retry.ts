import { TrackingProviderError } from "./errors";

export interface RetryOptions {
  /** Retries after the first attempt, so up to retries + 1 calls in total. */
  retries?: number;
  baseMs?: number;
  maxMs?: number;
  /** Injected so tests run instantly. */
  sleep?: (ms: number) => Promise<void>;
  /** Injected for deterministic jitter; returns [0, 1). */
  random?: () => number;
}

const defaultSleep = (ms: number) =>
  new Promise<void>((resolve) => setTimeout(resolve, ms));

/**
 * Runs fn, retrying errors flagged retryable with exponential back-off and
 * full jitter. Non-retryable errors and the final failure are rethrown as-is.
 */
export async function withRetry<T>(
  fn: () => Promise<T>,
  options: RetryOptions = {},
): Promise<T> {
  const {
    retries = 3,
    baseMs = 500,
    maxMs = 8000,
    sleep = defaultSleep,
    random = Math.random,
  } = options;

  for (let attempt = 0; ; attempt++) {
    try {
      return await fn();
    } catch (error) {
      const retryable =
        error instanceof TrackingProviderError && error.retryable;
      if (!retryable || attempt >= retries) throw error;
      const ceiling = Math.min(maxMs, baseMs * 2 ** attempt);
      await sleep(Math.floor(random() * ceiling));
    }
  }
}
