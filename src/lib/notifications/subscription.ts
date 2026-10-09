// A push subscription as the browser reports it, checked before it is stored.
// The server will later POST to its endpoint, so the endpoint must be a real
// push service: an attacker who could register any URL could make the server
// send requests to internal hosts. Only HTTPS endpoints on the push services
// the major browsers use are accepted.
import { z } from "zod";

/** Hostname suffixes of the push services behind Chrome, Firefox, Edge and Safari. */
export const PUSH_SERVICE_SUFFIXES = [
  "googleapis.com", // Chrome, Brave, Opera, Samsung Internet (FCM)
  "mozilla.com", // Firefox (autopush)
  "windows.com", // Edge (WNS)
  "apple.com", // Safari and iOS web push
] as const;

const MAX_ENDPOINT = 2048;

export function isAllowedPushEndpoint(value: string): boolean {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    return false;
  }
  if (url.protocol !== "https:") return false;
  if (url.username || url.password) return false;
  if (url.port && url.port !== "443") return false;
  const host = url.hostname.toLowerCase();
  return PUSH_SERVICE_SUFFIXES.some(
    (suffix) => host === suffix || host.endsWith(`.${suffix}`),
  );
}

const base64url = (min: number, max: number) =>
  z
    .string()
    .min(min)
    .max(max)
    .regex(/^[A-Za-z0-9_-]+={0,2}$/, "base64url");

/**
 * What `PushSubscription.toJSON()` gives, reduced to what we keep. p256dh is a
 * 65-byte public key (87 characters); auth is 16 bytes (22 characters); a
 * little slack is allowed for padding.
 */
export const pushSubscriptionSchema = z.object({
  endpoint: z
    .string()
    .max(MAX_ENDPOINT)
    .refine(isAllowedPushEndpoint, "not a push service endpoint"),
  keys: z.object({
    p256dh: base64url(80, 100),
    auth: base64url(16, 30),
  }),
});

export type PushSubscriptionInput = z.infer<typeof pushSubscriptionSchema>;
