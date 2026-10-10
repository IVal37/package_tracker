import { z } from "zod";
import type { Db } from "@/lib/db/client";
import {
  applyTrackerUpdate,
  findStaleTrackers,
  markTrackerSynced,
} from "@/lib/db/tracker-sync";
import { BREAKERS, isBreakerTripped, tripBreaker } from "@/lib/ratelimit";
import {
  ProviderAuthError,
  QuotaExceededError,
  TrackingProviderError,
  type TrackingProvider,
} from "@/lib/tracking";

/** Sent by the hourly sweep: re-fetch this one tracker. */
export const TRACKER_REFETCH = "wayfind/tracker.refetch";

export const trackerRefetchSchema = z.object({
  trackerId: z.string().min(1).max(200),
});

const HOUR_MS = 3_600_000;

export interface TrackerRefetchEvent {
  /** One per tracker per hour: a repeat send in the same hour is dropped. */
  id: string;
  name: typeof TRACKER_REFETCH;
  data: z.infer<typeof trackerRefetchSchema>;
}

export function buildRefetchEvents(
  trackerIds: readonly string[],
  now: Date,
): TrackerRefetchEvent[] {
  const bucket = Math.floor(now.getTime() / HOUR_MS);
  return trackerIds.map((trackerId) => ({
    id: `refetch-${trackerId}-${bucket}`,
    name: TRACKER_REFETCH,
    data: { trackerId },
  }));
}

/**
 * Trackers to re-fetch: no provider update for 24 hours (the webhook is the
 * normal path; this is the safety net), oldest first. None while the re-fetch
 * is paused by a bad key or an exhausted quota; the next hour tries again.
 */
export async function findTrackersToRefetch(args: {
  db: Db;
  provider: TrackingProvider;
  now: Date;
  limit: number;
}): Promise<string[]> {
  const { db, provider, now, limit } = args;
  if (await isBreakerTripped(db, BREAKERS.refetch, provider.name, now)) {
    return [];
  }
  return findStaleTrackers(db, provider.name, now, limit);
}

export type RefetchOutcome =
  | {
      outcome: "updated" | "unchanged";
      newCheckpoints: number;
      /** Alerts recorded by the update, for a job to deliver. */
      notificationIds: string[];
    }
  /** The provider rejected this tracker for good; marked synced so it is not retried. */
  | { outcome: "failed" }
  /** The re-fetch is paused this hour; the provider was not asked. */
  | { outcome: "paused" }
  /**
   * A bad API key or an exhausted quota. The re-fetch is paused for the hour
   * and the tracker left stale. `firstReport` is true for the one run that
   * should report it.
   */
  | { outcome: "stopped"; reason: "auth" | "quota"; firstReport: boolean };

/**
 * Re-fetches one tracker and applies the answer to every shipment on it.
 *
 * Errors:
 * - Bad API key or exhausted quota: pause the whole re-fetch for the hour
 *   (every other queued tracker then skips the provider) and leave this one
 *   stale. Marking it synced would hide it for a day.
 * - Retryable (rate limit, provider down): thrown, so the job retries.
 * - Permanent for this tracker: marked synced so it cannot sit at the front of
 *   the queue for ever.
 * - Anything else (a database error) is thrown.
 */
export async function refetchTracker(args: {
  db: Db;
  provider: TrackingProvider;
  trackerId: string;
  now: Date;
}): Promise<RefetchOutcome> {
  const { db, provider, trackerId, now } = args;
  if (await isBreakerTripped(db, BREAKERS.refetch, provider.name, now)) {
    return { outcome: "paused" };
  }

  let tracking;
  try {
    tracking = await provider.getTracking(trackerId);
  } catch (error) {
    if (!(error instanceof TrackingProviderError)) throw error;
    if (
      error instanceof ProviderAuthError ||
      error instanceof QuotaExceededError
    ) {
      const { first } = await tripBreaker(
        db,
        BREAKERS.refetch,
        provider.name,
        now,
      );
      return {
        outcome: "stopped",
        reason: error instanceof ProviderAuthError ? "auth" : "quota",
        firstReport: first,
      };
    }
    if (error.retryable) throw error;
    await markTrackerSynced(db, provider.name, trackerId, now);
    console.warn("re-fetch failed for a tracker", { error: error.name });
    return { outcome: "failed" };
  }

  const applied = await applyTrackerUpdate(db, provider.name, tracking, now);
  return {
    outcome: applied.newCheckpoints > 0 ? "updated" : "unchanged",
    newCheckpoints: applied.newCheckpoints,
    notificationIds: applied.notificationIds,
  };
}
