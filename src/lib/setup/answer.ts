import type { Db } from "@/lib/db/client";
import { saveSetupAnswer } from "@/lib/db/setup";
import { hit, LIMITS } from "@/lib/ratelimit";

export type AnswerResult = "saved" | "rate_limited" | "no_account";

/**
 * Records the signed-in user's answer to the setup prompt. The caller passes
 * the id from the verified session. Counted against a generous limit first, as
 * every action a signed-in user can repeat is.
 */
export async function answerSetup(args: {
  db: Db;
  userId: string;
  answer: "completed" | "skipped";
  now: Date;
}): Promise<AnswerResult> {
  const { db, userId, answer, now } = args;
  if (!(await hit(db, LIMITS.setupAnswer, userId, now)).allowed) {
    return "rate_limited";
  }
  return (await saveSetupAnswer(db, userId, answer, now))
    ? "saved"
    : "no_account";
}
