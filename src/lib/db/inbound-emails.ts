// Stored inbound emails. Every function takes the userId the email belongs to
// (found from its address by the webhook) and filters by it.
import { and, count, eq, gt } from "drizzle-orm";
import type { Db } from "./client";
import { inboundEmails } from "./schema";
import { isUniqueViolation } from "./shipments";

export interface NewInboundEmail {
  /** The normalized email as JSON text. */
  raw: string;
  messageId: string | null;
  fromAddress: string | null;
  subject: string | null;
  receivedAt: Date;
}

/** How many emails this user received since the given moment. */
export async function countEmailsSince(
  db: Db,
  userId: string,
  since: Date,
): Promise<number> {
  const [row] = await db
    .select({ total: count() })
    .from(inboundEmails)
    .where(
      and(
        eq(inboundEmails.userId, userId),
        gt(inboundEmails.receivedAt, since),
      ),
    );
  return row?.total ?? 0;
}

export async function hasMessageId(
  db: Db,
  userId: string,
  messageId: string,
): Promise<boolean> {
  const [row] = await db
    .select({ id: inboundEmails.id })
    .from(inboundEmails)
    .where(
      and(
        eq(inboundEmails.userId, userId),
        eq(inboundEmails.messageId, messageId),
      ),
    );
  return row !== undefined;
}

/**
 * Stores an email for the user and returns its id, or null if the same
 * Message-ID is already stored for them (also when two deliveries race).
 */
export async function insertInboundEmail(
  db: Db,
  userId: string,
  email: NewInboundEmail,
): Promise<string | null> {
  try {
    const [row] = await db
      .insert(inboundEmails)
      .values({ userId, ...email })
      .returning({ id: inboundEmails.id });
    return row?.id ?? null;
  } catch (error) {
    if (isUniqueViolation(error)) return null;
    throw error;
  }
}
