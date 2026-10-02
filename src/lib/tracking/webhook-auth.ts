import { timingSafeEqual } from "node:crypto";

/**
 * True only if the Authorization header is exactly `Bearer <secret>`.
 * Constant-time comparison; an empty secret never matches, so a missing
 * config cannot accidentally accept every request.
 */
export function verifyBearerSecret(headers: Headers, secret: string): boolean {
  if (!secret) return false;
  const received = Buffer.from(headers.get("authorization") ?? "");
  const expected = Buffer.from(`Bearer ${secret}`);
  return (
    received.length === expected.length && timingSafeEqual(received, expected)
  );
}
