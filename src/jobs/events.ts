import { GEOCODE_REQUESTED } from "@/lib/geo/place-events";
import { inngest } from "./client";

const SEND_TIMEOUT_MS = 2000;

/**
 * Asks the geocoding sweep to run soon. Best effort by design: callers are a
 * webhook (which must answer quickly and must not make the provider retry a
 * webhook we already applied) and a user action. If this fails, the hourly
 * sweep catches the new places anyway.
 */
export async function requestGeocoding(): Promise<void> {
  try {
    await Promise.race([
      inngest.send({ name: GEOCODE_REQUESTED }),
      new Promise<never>((_, reject) =>
        setTimeout(() => reject(new Error("timeout")), SEND_TIMEOUT_MS),
      ),
    ]);
  } catch (error) {
    // Name only; never the payload or any key.
    console.warn("geocode request not sent", {
      error: error instanceof Error ? error.name : "unknown",
    });
  }
}
