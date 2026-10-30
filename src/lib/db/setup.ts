// The first-run setup answer and what the app can see of the user's setup.
// Every function takes the userId and touches only that user's rows.
import { count, eq } from "drizzle-orm";
import type { Db } from "./client";
import { inboundEmails, pushSubscriptions, users } from "./schema";

export interface SetupAnswer {
  completedAt: Date | null;
  skippedAt: Date | null;
}

/** The user's setup answer, or null if there is no such user. */
export async function getSetupAnswer(
  db: Db,
  userId: string,
): Promise<SetupAnswer | null> {
  const [row] = await db
    .select({
      completedAt: users.setupCompletedAt,
      skippedAt: users.setupSkippedAt,
    })
    .from(users)
    .where(eq(users.id, userId));
  return row ?? null;
}

/**
 * Records the answer and clears the other one, in one statement (the database
 * allows at most one). Returns whether the user's row exists.
 */
export async function saveSetupAnswer(
  db: Db,
  userId: string,
  answer: "completed" | "skipped",
  now = new Date(),
): Promise<boolean> {
  const updated = await db
    .update(users)
    .set(
      answer === "completed"
        ? { setupCompletedAt: now, setupSkippedAt: null }
        : { setupSkippedAt: now, setupCompletedAt: null },
    )
    .where(eq(users.id, userId))
    .returning({ id: users.id });
  return updated.length > 0;
}

export interface SetupSignals {
  /** At least one email has reached the user's forwarding address. */
  emailsArriving: boolean;
  /** At least one device is registered for push alerts. */
  pushDevices: number;
}

/** Facts the app can know about the user's setup. Display only. */
export async function loadSetupSignals(
  db: Db,
  userId: string,
): Promise<SetupSignals> {
  const [emails] = await db
    .select({ total: count() })
    .from(inboundEmails)
    .where(eq(inboundEmails.userId, userId));
  const [devices] = await db
    .select({ total: count() })
    .from(pushSubscriptions)
    .where(eq(pushSubscriptions.userId, userId));
  return {
    emailsArriving: (emails?.total ?? 0) > 0,
    pushDevices: devices?.total ?? 0,
  };
}
