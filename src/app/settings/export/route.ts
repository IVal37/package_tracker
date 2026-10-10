import { requireUser } from "@/lib/auth/session";
import { getDb } from "@/lib/db/client";
import { getEnv } from "@/lib/env";
import { buildUserExport } from "@/lib/privacy/export";
import { LIMITS, hit, logLimited, tooManyRequests } from "@/lib/ratelimit";

export const dynamic = "force-dynamic";

/**
 * "Download my data": everything stored about the signed-in user as one JSON
 * file. The user comes from the session only, and the file is never cached.
 */
export async function GET(): Promise<Response> {
  const user = await requireUser();
  const db = getDb();
  const now = new Date();

  const verdict = await hit(db, LIMITS.exportData, user.id, now);
  if (!verdict.allowed) {
    logLimited(LIMITS.exportData.action);
    return tooManyRequests(verdict.retryAfterSeconds);
  }

  const data = await buildUserExport({
    db,
    userId: user.id,
    inboundDomain: getEnv().INBOUND_EMAIL_DOMAIN,
    now,
  });
  const day = now.toISOString().slice(0, 10);
  return new Response(JSON.stringify(data, null, 2), {
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      "Content-Disposition": `attachment; filename="wayfind-data-${day}.json"`,
      "Cache-Control": "no-store",
    },
  });
}
