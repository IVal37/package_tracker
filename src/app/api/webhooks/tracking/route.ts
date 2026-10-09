import { requestGeocoding, requestNotifications } from "@/jobs/events";
import { getDb } from "@/lib/db/client";
import { handleTrackingWebhook } from "@/lib/shipments/sync/handle-webhook";
import { getTrackingProvider } from "@/lib/tracking";

export const dynamic = "force-dynamic";

/**
 * Tracking-provider webhook. Authenticated by the provider's own secret (not a
 * user session). Reads the raw body, applies it, and answers quickly; any
 * failure we can't classify is a 500 so the provider retries.
 */
export async function POST(request: Request): Promise<Response> {
  try {
    const outcome = await handleTrackingWebhook({
      db: getDb(),
      provider: getTrackingProvider(),
      rawBody: await request.text(),
      headers: request.headers,
      now: new Date(),
    });
    console.info("tracking webhook", {
      status: outcome.status,
      applied: outcome.applied,
      newCheckpoints: outcome.newCheckpoints,
    });
    // New checkpoints may mention places we haven't geocoded. Best effort: it
    // never changes this response (the hourly sweep is the backstop).
    if (outcome.newCheckpoints > 0) await requestGeocoding();
    // Alerts were recorded with the update; a job delivers them. Best effort
    // too: the hourly notifications sweep re-queues any that this misses.
    await requestNotifications(outcome.notificationIds);
    return new Response(null, { status: outcome.status });
  } catch (error) {
    // Name only: never the body, headers or secret.
    console.error("tracking webhook failed", {
      error: error instanceof Error ? error.name : "unknown",
    });
    return new Response(null, { status: 500 });
  }
}
