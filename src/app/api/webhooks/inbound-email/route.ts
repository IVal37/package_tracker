import { requestEmailProcessing } from "@/jobs/events";
import { getDb } from "@/lib/db/client";
import { receiveInboundEmail } from "@/lib/email/receive";
import { getEnv } from "@/lib/env";

export const dynamic = "force-dynamic";

/**
 * Inbound email webhook, called by the Cloudflare Email Worker with a shared
 * secret. It authenticates, stores the email and queues it for reading, then
 * answers; the reading happens in a background job.
 */
export async function POST(request: Request): Promise<Response> {
  try {
    const env = getEnv();
    const outcome = await receiveInboundEmail({
      db: getDb(),
      rawBody: await request.text(),
      headers: request.headers,
      now: new Date(),
      secret: env.INBOUND_WEBHOOK_SECRET,
      domain: env.INBOUND_EMAIL_DOMAIN,
      dailyLimit: env.INBOUND_DAILY_LIMIT,
    });
    // The outcome only: never the body, subject, addresses or secret.
    console.info("inbound email", { outcome: outcome.outcome });
    // Best effort: the hourly sweep picks up anything this misses.
    if (outcome.emailId) await requestEmailProcessing(outcome.emailId);
    return new Response(null, { status: outcome.status });
  } catch (error) {
    console.error("inbound email failed", {
      error: error instanceof Error ? error.name : "unknown",
    });
    return new Response(null, { status: 500 });
  }
}
