// Rate limiting backed by Postgres, so every server instance shares one count.
// Not system-scope: it takes a key and returns a verdict, nothing else.
import { createHash } from "node:crypto";
import type { Db } from "@/lib/db/client";
import { countHit, deleteRateLimitWindowsBefore } from "@/lib/db/rate-limits";
import { KEEP_WINDOWS_MS, LIMITS, type Limit } from "./limits";

export { LIMITS, type Limit } from "./limits";

export interface Verdict {
  allowed: boolean;
  /** Seconds until the window that refused this resets; 0 when allowed. */
  retryAfterSeconds: number;
}

/**
 * The key a subject is counted under. Emails and IP addresses are hashed so the
 * table never holds anything readable; user ids and aliases are already opaque
 * but are hashed too, so every key looks the same.
 */
export function limitKey(limit: Limit, subject: string): string {
  const digest = createHash("sha256")
    .update(subject)
    .digest("base64url")
    .slice(0, 22);
  return `${limit.action}:${digest}`;
}

/** Counts one use of `limit` by `subject` and says whether it is allowed. */
export async function hit(
  db: Db,
  limit: Limit,
  subject: string,
  now: Date,
): Promise<Verdict> {
  const start = Math.floor(now.getTime() / limit.windowMs) * limit.windowMs;
  const count = await countHit(db, limitKey(limit, subject), new Date(start));
  if (count <= limit.limit) return { allowed: true, retryAfterSeconds: 0 };
  return {
    allowed: false,
    retryAfterSeconds: Math.max(
      1,
      Math.ceil((start + limit.windowMs - now.getTime()) / 1000),
    ),
  };
}

/**
 * Counts one use against each of several limits (say, per minute and per day)
 * and allows it only if every one allows it. Every limit is counted, so a
 * refused burst still uses up the longer window.
 */
export async function hitAll(
  db: Db,
  checks: readonly { limit: Limit; subject: string }[],
  now: Date,
): Promise<Verdict> {
  const verdicts: Verdict[] = [];
  for (const check of checks) {
    verdicts.push(await hit(db, check.limit, check.subject, now));
  }
  const refused = verdicts.filter((verdict) => !verdict.allowed);
  return refused.length === 0
    ? { allowed: true, retryAfterSeconds: 0 }
    : {
        allowed: false,
        retryAfterSeconds: Math.max(...refused.map((v) => v.retryAfterSeconds)),
      };
}

/** Logs that a limit refused something: the action only, never the key or subject. */
export function logLimited(action: string): void {
  console.warn("rate limited", { action });
}

/**
 * The client's IP for use as a rate-limit key, and for nothing else. Vercel
 * sets x-real-ip; elsewhere the first x-forwarded-for entry is the client.
 */
export function clientIp(headers: Headers): string {
  const direct = headers.get("x-real-ip")?.trim();
  const forwarded = headers.get("x-forwarded-for")?.split(",")[0]?.trim();
  return (direct || forwarded || "unknown").slice(0, 64);
}

/** The answer a limited route handler gives. */
export function tooManyRequests(retryAfterSeconds: number): Response {
  return new Response(null, {
    status: 429,
    headers: { "Retry-After": String(retryAfterSeconds) },
  });
}

/** Deletes windows older than any limit needs. Run daily. */
export async function cleanupRateLimits(args: {
  db: Db;
  now: Date;
}): Promise<{ deleted: number }> {
  const cutoff = new Date(args.now.getTime() - KEEP_WINDOWS_MS);
  return { deleted: await deleteRateLimitWindowsBefore(args.db, cutoff) };
}

/** Sign-in links: per client IP and per email address. */
export function hitSignIn(
  db: Db,
  args: { ip: string; email: string; now: Date },
): Promise<Verdict> {
  return hitAll(
    db,
    [
      { limit: LIMITS.signInIp, subject: args.ip },
      { limit: LIMITS.signInEmail, subject: args.email },
    ],
    args.now,
  );
}

/** Adding a package by hand: per user, per minute and per day. */
export function hitAddPackage(
  db: Db,
  userId: string,
  now: Date,
): Promise<Verdict> {
  return hitAll(
    db,
    [
      { limit: LIMITS.addPackageMinute, subject: userId },
      { limit: LIMITS.addPackageDay, subject: userId },
    ],
    now,
  );
}
