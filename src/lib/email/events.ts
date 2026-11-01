import { z } from "zod";
import { hourBucket } from "@/lib/time";

/** Sent when an inbound email has been stored and is ready to be read. */
export const EMAIL_RECEIVED = "wayfind/email.received";

export const emailReceivedSchema = z.object({ emailId: z.string().min(1) });

type EmailReceivedData = z.infer<typeof emailReceivedSchema>;

export interface EmailEvent {
  /** One per email per hour: the sweep can re-queue a stuck email, but not flood it. */
  id: string;
  name: typeof EMAIL_RECEIVED;
  data: EmailReceivedData;
}

/** Events for the hourly sweep to re-queue emails whose first event never ran. */
export function buildEmailEvents(
  emailIds: readonly string[],
  now: Date,
): EmailEvent[] {
  const bucket = hourBucket(now);
  return emailIds.map((emailId) => ({
    id: `email-${emailId}-sweep-${bucket}`,
    name: EMAIL_RECEIVED,
    data: { emailId },
  }));
}
