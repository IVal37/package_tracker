// SYSTEM-SCOPE queries for the inbound email webhook and its jobs. No user is
// signed in when they run: the webhook turns the address an email was sent to
// into its owner, and the jobs read stored emails by id. Nothing here takes a
// userId. ESLint lets only src/lib/email and src/jobs import this module. The
// stored email content it returns is read by the processing job only and is
// never rendered or returned to a page.
import { and, eq, isNull, lt } from "drizzle-orm";
import type { Db } from "./client";
import { inboundEmails, orders, users } from "./schema";

/** The user who owns this forwarding alias, or null. The alias must be lower-case. */
export async function findUserIdByAlias(
  db: Db,
  alias: string,
): Promise<string | null> {
  const [row] = await db
    .select({ id: users.id })
    .from(users)
    .where(eq(users.forwardingAlias, alias));
  return row?.id ?? null;
}

export interface StoredInboundEmail {
  id: string;
  userId: string;
  raw: string;
  parseStatus: "pending" | "parsed" | "failed" | "ignored";
}

/** One stored email, for the job that reads it. */
export async function loadInboundEmail(
  db: Db,
  emailId: string,
): Promise<StoredInboundEmail | null> {
  const [row] = await db
    .select({
      id: inboundEmails.id,
      userId: inboundEmails.userId,
      raw: inboundEmails.raw,
      parseStatus: inboundEmails.parseStatus,
    })
    .from(inboundEmails)
    .where(eq(inboundEmails.id, emailId));
  return row ?? null;
}

/** Ids of emails still pending that arrived before the cutoff, oldest first. */
export async function findStalePendingEmailIds(
  db: Db,
  receivedBefore: Date,
  limit: number,
): Promise<string[]> {
  const rows = await db
    .select({ id: inboundEmails.id })
    .from(inboundEmails)
    .where(
      and(
        eq(inboundEmails.parseStatus, "pending"),
        lt(inboundEmails.receivedAt, receivedBefore),
      ),
    )
    .orderBy(inboundEmails.receivedAt)
    .limit(limit);
  return rows.map((row) => row.id);
}

/** Deletes stored emails received before the cutoff, whatever their status. Returns how many. */
export async function deleteEmailsBefore(
  db: Db,
  cutoff: Date,
): Promise<number> {
  const deleted = await db
    .delete(inboundEmails)
    .where(lt(inboundEmails.receivedAt, cutoff))
    .returning({ id: inboundEmails.id });
  return deleted.length;
}

/** Deletes "Ordered" placeholders (no shipment) created before the cutoff. Returns how many. */
export async function deleteStaleOrdersBefore(
  db: Db,
  cutoff: Date,
): Promise<number> {
  const deleted = await db
    .delete(orders)
    .where(and(isNull(orders.shipmentId), lt(orders.createdAt, cutoff)))
    .returning({ id: orders.id });
  return deleted.length;
}
