import type { Db } from "@/lib/db/client";
import { finishEmail } from "@/lib/db/inbound-emails";
import {
  gmailConfirmationRecord,
  parseGmailConfirmation,
} from "./gmail-confirmation";

/**
 * If this stored email is Gmail's forwarding confirmation, keeps its code or
 * link and finishes the email as ignored. Says whether it was one. Both parts
 * of the email are searched: the link may sit only in the HTML.
 */
export async function keepGmailConfirmation(
  db: Db,
  userId: string,
  emailId: string,
  email: { from: string; text: string },
  fromHtml: string,
): Promise<boolean> {
  const gmail = parseGmailConfirmation({
    from: email.from,
    text: `${email.text}\n${fromHtml}`,
  });
  if (!gmail) return false;
  await finishEmail(
    db,
    userId,
    emailId,
    "ignored",
    gmailConfirmationRecord(gmail),
  );
  return true;
}
