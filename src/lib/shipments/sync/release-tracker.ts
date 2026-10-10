import type { Db } from "@/lib/db/client";
import { isTrackerFollowedByOthers } from "@/lib/db/tracker-sync";
import { TrackerNotFoundError, type TrackingProvider } from "@/lib/tracking";

export type ReleaseOutcome =
  /** Nobody else follows it: the provider was asked to stop tracking it. */
  | "unsubscribed"
  /** Another user still follows it, so it was left alone. */
  | "shared"
  /** The provider already did not know it. */
  | "gone"
  /** The provider failed; logged, and never blocks the delete. */
  | "failed";

/**
 * Stops the provider tracking a number when this user is giving up their last
 * shipment on it. One tracker is shared by every user who added the same
 * number, so it is unsubscribed only when no one else still follows it.
 *
 * Call it before deleting the user's shipment (or account). Racing with
 * someone adding the same number at that moment could still unsubscribe a
 * tracker they now use; adding a known number subscribes it again, and the
 * daily re-fetch covers the rest.
 */
export async function releaseTracker(args: {
  db: Db;
  provider: TrackingProvider;
  trackerId: string;
  userId: string;
}): Promise<ReleaseOutcome> {
  const { db, provider, trackerId, userId } = args;
  if (await isTrackerFollowedByOthers(db, provider.name, trackerId, userId)) {
    return "shared";
  }
  try {
    await provider.deleteTracking(trackerId);
    return "unsubscribed";
  } catch (error) {
    if (error instanceof TrackerNotFoundError) return "gone";
    const name = error instanceof Error ? error.name : "unknown error";
    console.error(`[releaseTracker] provider failure: ${name}`);
    return "failed";
  }
}
