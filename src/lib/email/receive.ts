import { z } from "zod";
import { verifyBearerSecret } from "@/lib/auth/bearer";
import type { Db } from "@/lib/db/client";
import {
  countEmailsSince,
  hasMessageId,
  insertInboundEmail,
} from "@/lib/db/inbound-emails";
import { findUserIdByAlias } from "@/lib/db/inbound-sync";
import { aliasFromRecipient } from "./alias";

/** Largest request body we read. The Worker sends far less. */
export const MAX_BODY_CHARS = 1_000_000;
/** What the Worker is told to cap text and HTML at; larger is refused. */
export const MAX_PART_CHARS = 200_000;

const DAY_MS = 24 * 60 * 60 * 1000;

/** The provider-neutral body the Cloudflare Worker (or a test) POSTs. */
export const inboundEmailSchema = z.object({
  /** The envelope recipient: the address it was really delivered to. */
  recipient: z.string().min(1).max(320),
  from: z.string().max(998).default(""),
  subject: z.string().max(998).default(""),
  messageId: z.string().max(998).nullish(),
  date: z.string().max(100).nullish(),
  text: z.string().max(MAX_PART_CHARS).default(""),
  html: z.string().max(MAX_PART_CHARS).default(""),
});

export type InboundEmail = z.infer<typeof inboundEmailSchema>;

export type ReceiveOutcome =
  | "stored"
  | "unknown_alias"
  | "duplicate"
  | "over_limit"
  | "unauthorized"
  | "too_large"
  | "invalid";

export interface ReceiveResult {
  /** HTTP status for the route. Database errors throw instead (500). */
  status: 200 | 401 | 413 | 422;
  outcome: ReceiveOutcome;
  /** Set only when the email was stored. */
  emailId?: string;
}

const result = (
  status: ReceiveResult["status"],
  outcome: ReceiveOutcome,
  emailId?: string,
): ReceiveResult => ({ status, outcome, ...(emailId && { emailId }) });

/**
 * Authenticates and stores one inbound email. An unknown address, a repeat of
 * the same Message-ID and a user over their daily limit all answer 200 and
 * store nothing, so the sender never retries and a prober learns nothing.
 * The user comes from the address alone, never from anything in the email.
 */
export async function receiveInboundEmail(args: {
  db: Db;
  rawBody: string;
  headers: Headers;
  now: Date;
  secret: string;
  domain: string;
  dailyLimit: number;
}): Promise<ReceiveResult> {
  const { db, rawBody, headers, now, secret, domain, dailyLimit } = args;

  if (!verifyBearerSecret(headers, secret)) return result(401, "unauthorized");
  if (rawBody.length > MAX_BODY_CHARS) return result(413, "too_large");

  let json: unknown;
  try {
    json = JSON.parse(rawBody);
  } catch {
    return result(422, "invalid");
  }
  const parsed = inboundEmailSchema.safeParse(json);
  if (!parsed.success) return result(422, "invalid");
  const email = parsed.data;

  const alias = aliasFromRecipient(email.recipient, domain);
  const userId = alias ? await findUserIdByAlias(db, alias) : null;
  if (!userId) return result(200, "unknown_alias");

  const messageId = email.messageId?.trim() || null;
  if (messageId && (await hasMessageId(db, userId, messageId))) {
    return result(200, "duplicate");
  }
  if (
    (await countEmailsSince(db, userId, new Date(now.getTime() - DAY_MS))) >=
    dailyLimit
  ) {
    return result(200, "over_limit");
  }

  const emailId = await insertInboundEmail(db, userId, {
    raw: JSON.stringify({
      from: email.from,
      subject: email.subject,
      date: email.date ?? null,
      text: email.text,
      html: email.html,
    }),
    messageId,
    fromAddress: email.from.slice(0, 320) || null,
    subject: email.subject.slice(0, 300) || null,
    receivedAt: now,
  });
  return emailId ? result(200, "stored", emailId) : result(200, "duplicate");
}
