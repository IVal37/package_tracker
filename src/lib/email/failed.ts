// Emails that could not be read: why, in words for the Settings page, and
// trying one again.
import type { Db } from "@/lib/db/client";
import { resetFailedEmail } from "@/lib/db/inbound-emails";
import { LIMITS, hit, logLimited } from "@/lib/ratelimit";

/**
 * A plain reason for the Settings page. The stored error is our own message
 * (never text from the email), but it is still mapped to fixed sentences
 * rather than shown as it is.
 */
export function failureReason(error: string | null): string {
  if (error === "unreadable") return "The email could not be opened.";
  if (
    error &&
    /unavailable|rate limit|server error|could not reach|rejected the api key/i.test(
      error,
    )
  ) {
    return "A service we rely on was down when it arrived.";
  }
  if (error && /model|answer|json|declined|cut off/i.test(error)) {
    return "We couldn't make out the order or tracking details.";
  }
  return "We couldn't read it.";
}

export type RetryEmailResult = "retried" | "not_found" | "rate_limited";

/**
 * Puts a failed email back in the queue for the signed-in user. Each try asks
 * the model again, so it is limited per user (LIMITS.retryEmail). Another
 * user's email, or one that did not fail, is "not_found".
 */
export async function retryFailedEmail(args: {
  db: Db;
  userId: string;
  emailId: string;
  now: Date;
}): Promise<RetryEmailResult> {
  const { db, userId, emailId, now } = args;
  if (!(await hit(db, LIMITS.retryEmail, userId, now)).allowed) {
    logLimited(LIMITS.retryEmail.action);
    return "rate_limited";
  }
  return (await resetFailedEmail(db, userId, emailId))
    ? "retried"
    : "not_found";
}
