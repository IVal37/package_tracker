// Stored inbound emails. Every function takes the userId the email belongs to
// (found from its address by the webhook) and filters by it.
import { and, count, desc, eq, gt } from "drizzle-orm";
import { z } from "zod";
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

const gmailConfirmationSchema = z.object({
  kind: z.literal("gmail_forwarding_confirmation"),
  code: z.string().regex(/^\d{6,10}$/),
});

/**
 * The newest Gmail forwarding confirmation code this user received since the
 * given moment, for the Settings page. Only the digits are ever stored.
 */
export async function latestGmailConfirmation(
  db: Db,
  userId: string,
  since: Date,
): Promise<{ code: string; receivedAt: Date } | null> {
  const rows = await db
    .select({
      extracted: inboundEmails.extracted,
      receivedAt: inboundEmails.receivedAt,
    })
    .from(inboundEmails)
    .where(
      and(
        eq(inboundEmails.userId, userId),
        eq(inboundEmails.parseStatus, "ignored"),
        gt(inboundEmails.receivedAt, since),
      ),
    )
    .orderBy(desc(inboundEmails.receivedAt))
    .limit(20);

  for (const row of rows) {
    const parsed = gmailConfirmationSchema.safeParse(row.extracted);
    if (parsed.success) {
      return { code: parsed.data.code, receivedAt: row.receivedAt };
    }
  }
  return null;
}

/** How many of this user's emails could not be read. */
export async function countFailedEmails(
  db: Db,
  userId: string,
): Promise<number> {
  const [row] = await db
    .select({ total: count() })
    .from(inboundEmails)
    .where(
      and(
        eq(inboundEmails.userId, userId),
        eq(inboundEmails.parseStatus, "failed"),
      ),
    );
  return row?.total ?? 0;
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
 * Records what became of a pending email. Only a pending email can be
 * finished, so a second run cannot overwrite the first result. Returns whether
 * a row changed.
 */
export async function finishEmail(
  db: Db,
  userId: string,
  emailId: string,
  status: "parsed" | "ignored" | "failed",
  extracted: unknown,
): Promise<boolean> {
  const updated = await db
    .update(inboundEmails)
    .set({ parseStatus: status, extracted })
    .where(
      and(
        eq(inboundEmails.id, emailId),
        eq(inboundEmails.userId, userId),
        eq(inboundEmails.parseStatus, "pending"),
      ),
    )
    .returning({ id: inboundEmails.id });
  return updated.length > 0;
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
