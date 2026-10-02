import type { ZodType } from "zod";
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
  type TrackingProviderError,
} from "../errors";
import { withRetry, type RetryOptions } from "../retry";
import { ship24ErrorBodySchema } from "./schemas";

export const SHIP24_BASE_URL = "https://api.ship24.com";

export interface Ship24ClientConfig {
  apiKey: string;
  baseUrl?: string;
  fetch?: typeof fetch;
  retry?: RetryOptions;
  timeoutMs?: number;
}

export interface Ship24Request<T> {
  method: "GET" | "POST" | "PATCH";
  path: string;
  body?: unknown;
  /** Omit to skip reading the response body. */
  schema?: ZodType<T>;
}

async function errorCode(response: Response): Promise<string | undefined> {
  try {
    const parsed = ship24ErrorBodySchema.safeParse(await response.json());
    return parsed.success ? parsed.data.errors[0]?.code : undefined;
  } catch {
    return undefined;
  }
}

async function toProviderError(
  response: Response,
): Promise<TrackingProviderError> {
  const code = await errorCode(response);
  const label = `Ship24 responded ${response.status}${code ? ` (${code})` : ""}`;
  const { status } = response;

  if (status === 401) return new ProviderAuthError(label);
  if (status === 400) return new InvalidTrackingNumberError(label);
  if (status === 403) return new QuotaExceededError(label);
  if (status === 404) return new TrackerNotFoundError(label);
  if (status === 409) {
    return code === "tracker_conflict"
      ? new TrackerConflictError(label)
      : new RequestConflictError(label);
  }
  if (status === 429) return new RateLimitedError(label);
  if (status >= 500) return new ProviderUnavailableError(label);
  return new ProviderResponseError(label);
}

/**
 * One Ship24 call: bearer auth, timeout, zod-validated response, HTTP errors
 * mapped to typed errors, and retries for rate limits, 5xx and network errors.
 */
export async function ship24Request<T = void>(
  config: Ship24ClientConfig,
  request: Ship24Request<T>,
): Promise<T> {
  const {
    apiKey,
    baseUrl = SHIP24_BASE_URL,
    fetch: fetchFn = fetch,
    retry,
    timeoutMs = 10_000,
  } = config;

  return withRetry(async () => {
    let response: Response;
    try {
      response = await fetchFn(`${baseUrl}${request.path}`, {
        method: request.method,
        headers: {
          Authorization: `Bearer ${apiKey}`,
          "Content-Type": "application/json; charset=utf-8",
        },
        body:
          request.body === undefined ? undefined : JSON.stringify(request.body),
        signal: AbortSignal.timeout(timeoutMs),
      });
    } catch {
      // Deliberately not chaining the cause: it can echo request details.
      throw new ProviderUnavailableError("Could not reach Ship24");
    }

    if (!response.ok) throw await toProviderError(response);
    if (!request.schema) return undefined as T;

    let json: unknown;
    try {
      json = await response.json();
    } catch {
      throw new ProviderResponseError("Ship24 returned a non-JSON body");
    }
    const parsed = request.schema.safeParse(json);
    if (!parsed.success) {
      throw new ProviderResponseError("Ship24 response failed validation");
    }
    return parsed.data;
  }, retry);
}
