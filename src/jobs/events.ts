import { EMAIL_RECEIVED } from "@/lib/email/events";
import { GEOCODE_REQUESTED } from "@/lib/geo/place-events";
import { inngest } from "./client";

const SEND_TIMEOUT_MS = 2000;

type Event = Parameters<typeof inngest.send>[0];

/**
 * Sends an event without ever failing or holding up the caller. The callers are
 * webhooks (which must answer quickly and must not make the sender retry
 * something we already stored) and user actions. Each event has an hourly
 * sweep as a backstop, so a lost send only delays the work.
 */
async function sendBestEffort(what: string, event: Event): Promise<void> {
  try {
    await Promise.race([
      inngest.send(event),
      new Promise<never>((_, reject) =>
        setTimeout(() => reject(new Error("timeout")), SEND_TIMEOUT_MS),
      ),
    ]);
  } catch (error) {
    // Name only; never the payload or any key.
    console.warn(`${what} not sent`, {
      error: error instanceof Error ? error.name : "unknown",
    });
  }
}

/** Asks the geocoding sweep to run soon. */
export function requestGeocoding(): Promise<void> {
  return sendBestEffort("geocode request", { name: GEOCODE_REQUESTED });
}

/** Asks for one stored email to be read. The id makes a repeat send harmless. */
export function requestEmailProcessing(emailId: string): Promise<void> {
  return sendBestEffort("email processing request", {
    name: EMAIL_RECEIVED,
    id: `email-${emailId}`,
    data: { emailId },
  });
}
