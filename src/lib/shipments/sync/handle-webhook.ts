import type { Db } from "@/lib/db/client";
import { applyTrackerUpdate } from "@/lib/db/tracker-sync";
import {
  ProviderResponseError,
  WebhookAuthError,
  type TrackingProvider,
} from "@/lib/tracking";

export interface WebhookOutcome {
  /** HTTP status for the route to return. Database errors throw instead (500). */
  status: 200 | 401 | 422;
  /** Shipments updated, summed over every tracking in the webhook. */
  applied: number;
  newCheckpoints: number;
  /** Alerts recorded by this webhook; the route asks a job to deliver them. */
  notificationIds: string[];
}

const rejected = (status: 401 | 422): WebhookOutcome => ({
  status,
  applied: 0,
  newCheckpoints: 0,
  notificationIds: [],
});

/**
 * Authenticates and applies one provider webhook. 401 means unauthenticated;
 * 422 means authenticated but unreadable (Ship24 retries it, so a payload we
 * wrongly reject is recovered once a fix ships). A tracker nobody follows is a
 * 200: there is nothing to retry. Applying is idempotent, so redelivery is safe.
 */
export async function handleTrackingWebhook(args: {
  db: Db;
  provider: TrackingProvider;
  rawBody: string;
  headers: Headers;
  now: Date;
}): Promise<WebhookOutcome> {
  const { db, provider, rawBody, headers, now } = args;

  let trackings;
  try {
    trackings = await provider.parseWebhook(rawBody, headers);
  } catch (error) {
    if (error instanceof WebhookAuthError) return rejected(401);
    if (error instanceof ProviderResponseError) return rejected(422);
    throw error;
  }

  let applied = 0;
  let newCheckpoints = 0;
  const notificationIds: string[] = [];
  for (const tracking of trackings) {
    const result = await applyTrackerUpdate(db, provider.name, tracking, now);
    applied += result.shipments;
    newCheckpoints += result.newCheckpoints;
    notificationIds.push(...result.notificationIds);
  }
  return { status: 200, applied, newCheckpoints, notificationIds };
}
