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
    return new Response(null, { status: outcome.status });
  } catch (error) {
    // Name only: never the body, headers or secret.
    console.error("tracking webhook failed", {
      error: error instanceof Error ? error.name : "unknown",
    });
    return new Response(null, { status: 500 });
  }
}
