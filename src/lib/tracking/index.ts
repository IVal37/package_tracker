// The only entry point the rest of the app uses for tracking. Provider classes
// live in ./ship24 and ./fake and must not be imported from outside this
// folder (enforced by ESLint no-restricted-imports).
import { getEnv, type Env } from "@/lib/env";
import { FakeProvider } from "./fake/provider";
import { Ship24Provider } from "./ship24/provider";
import type { TrackingProvider } from "./types";

export * from "./errors";
export { dedupeEvents, normalizeTrackingNumber } from "./normalize";
export { MODES, STATUSES, type Mode, type Status } from "./status";
export type {
  CreateTrackingInput,
  NormalizedEvent,
  NormalizedShipment,
  TrackingProvider,
} from "./types";

type ProviderEnv = Pick<
  Env,
  | "TRACKING_PROVIDER"
  | "SHIP24_API_KEY"
  | "SHIP24_WEBHOOK_SECRET"
  | "FAKE_WEBHOOK_SECRET"
>;

/** Pure: builds the provider an env asks for. */
export function createTrackingProvider(env: ProviderEnv): TrackingProvider {
  if (env.TRACKING_PROVIDER === "ship24") {
    if (!env.SHIP24_API_KEY || !env.SHIP24_WEBHOOK_SECRET) {
      throw new Error(
        "Invalid environment: missing SHIP24_API_KEY or SHIP24_WEBHOOK_SECRET",
      );
    }
    return new Ship24Provider({
      apiKey: env.SHIP24_API_KEY,
      webhookSecret: env.SHIP24_WEBHOOK_SECRET,
    });
  }
  return new FakeProvider({ webhookSecret: env.FAKE_WEBHOOK_SECRET });
}

let cached: TrackingProvider | undefined;

/** Lazy per-process singleton chosen by TRACKING_PROVIDER. */
export function getTrackingProvider(): TrackingProvider {
  cached ??= createTrackingProvider(getEnv());
  return cached;
}

/** Test helper: drop the cached provider. */
export function resetTrackingProviderCache(): void {
  cached = undefined;
}
