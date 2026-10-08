import type { Db } from "@/lib/db/client";
import {
  applyTrackerUpdate,
  findStaleTrackers,
  markTrackerSynced,
} from "@/lib/db/tracker-sync";
import {
  ProviderAuthError,
  QuotaExceededError,
  TrackingProviderError,
  type TrackingProvider,
} from "@/lib/tracking";

export interface RefetchResult {
  /** Trackers that got a definitive answer: updated, or failed for good. */
  checked: number;
  /** Of those, how many brought at least one new checkpoint. */
  updated: number;
  /** Trackers the provider rejected permanently (e.g. no longer known). */
  failed: number;
  /** The run stopped early; the rest is picked up next run. */
  stoppedEarly: boolean;
}

/**
 * Re-fetches shipments that have had no provider update for 24 hours (the
 * webhook is the normal path; this is the safety net). Oldest first, at most
 * `limit` trackers per run.
 *
 * Errors:
 * - Retryable (rate limit, provider down) and systemic (bad API key, quota):
 *   stop the run and leave the rest stale for next time. Marking them synced
 *   would hide every shipment for a day.
 * - Permanent per-tracker errors: mark that tracker synced so it can't sit at
 *   the front of the queue forever, and carry on.
 * - Anything else (a database error) propagates so the job retries.
 */
export async function refetchStaleShipments(args: {
  db: Db;
  provider: TrackingProvider;
  now: Date;
  limit: number;
}): Promise<RefetchResult> {
  const { db, provider, now, limit } = args;
  const result: RefetchResult = {
    checked: 0,
    updated: 0,
    failed: 0,
    stoppedEarly: false,
  };

  for (const trackerId of await findStaleTrackers(
    db,
    provider.name,
    now,
    limit,
  )) {
    let tracking;
    try {
      tracking = await provider.getTracking(trackerId);
    } catch (error) {
      if (!(error instanceof TrackingProviderError)) throw error;
      if (
        error.retryable ||
        error instanceof ProviderAuthError ||
        error instanceof QuotaExceededError
      ) {
        result.stoppedEarly = true;
        break;
      }
      await markTrackerSynced(db, provider.name, trackerId, now);
      result.checked += 1;
      result.failed += 1;
      console.warn("re-fetch failed for a tracker", { error: error.name });
      continue;
    }

    const applied = await applyTrackerUpdate(db, provider.name, tracking, now);
    result.checked += 1;
    if (applied.newCheckpoints > 0) result.updated += 1;
  }

  return result;
}
