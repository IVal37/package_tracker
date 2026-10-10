// @vitest-environment node
import { eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { createTestDb } from "../../../tests/db/pglite";
import { rateLimits } from "@/lib/db/schema";
import {
  BREAKERS,
  LIMITS,
  cleanupRateLimits,
  clientIp,
  hit,
  hitAddPackage,
  hitAll,
  hitSignIn,
  isBreakerTripped,
  limitKey,
  logLimited,
  tooManyRequests,
  tripBreaker,
  type Limit,
} from "./index";

let ctx: Awaited<ReturnType<typeof createTestDb>>;

beforeAll(async () => {
  ctx = await createTestDb();
});

afterAll(async () => {
  await ctx.client.close();
});

// 12:00:10, ten seconds into a minute window.
const NOW = new Date("2026-10-09T12:00:10Z");
const at = (ms: number) => new Date(NOW.getTime() + ms);
let n = 0;
/** A limit of its own per test, so tests never share counts. */
const limit = (max: number, windowMs = 60_000): Limit => ({
  action: `test-${++n}`,
  limit: max,
  windowMs,
});

describe("hit", () => {
  it("allows up to the limit and refuses after, across separate calls", async () => {
    const three = limit(3);
    const verdicts = [];
    for (let i = 0; i < 5; i++) {
      verdicts.push(await hit(ctx.db, three, "user-a", at(i * 1000)));
    }
    expect(verdicts.map((v) => v.allowed)).toEqual([
      true,
      true,
      true,
      false,
      false,
    ]);
    // Refused at 12:00:13, the window resets at 12:01:00.
    expect(verdicts[3]).toEqual({ allowed: false, retryAfterSeconds: 47 });
    expect(verdicts[0]?.retryAfterSeconds).toBe(0);
  });

  it("starts again in the next window", async () => {
    const one = limit(1);
    expect((await hit(ctx.db, one, "u", NOW)).allowed).toBe(true);
    expect((await hit(ctx.db, one, "u", at(30_000))).allowed).toBe(false);
    // 12:01:00 is a new window.
    expect((await hit(ctx.db, one, "u", at(50_000))).allowed).toBe(true);
  });

  it("keeps subjects and actions apart", async () => {
    const first = limit(1);
    const second = limit(1);
    expect((await hit(ctx.db, first, "u1", NOW)).allowed).toBe(true);
    expect((await hit(ctx.db, first, "u1", NOW)).allowed).toBe(false);
    // Another user is not held up by it...
    expect((await hit(ctx.db, first, "u2", NOW)).allowed).toBe(true);
    // ...and the same user is not held up in another action.
    expect((await hit(ctx.db, second, "u1", NOW)).allowed).toBe(true);
  });

  it("counts concurrent hits exactly once each (a shared counter)", async () => {
    const ten = limit(10);
    const verdicts = await Promise.all(
      Array.from({ length: 15 }, () => hit(ctx.db, ten, "burst", NOW)),
    );
    expect(verdicts.filter((v) => v.allowed)).toHaveLength(10);
    // One row for this key and window holds every hit.
    const rows = await ctx.db
      .select()
      .from(rateLimits)
      .where(eq(rateLimits.key, limitKey(ten, "burst")));
    expect(rows.map((row) => row.count)).toEqual([15]);
  });

  it("never stores the subject itself", async () => {
    const key = limitKey(LIMITS.signInEmail, "person@example.test");
    expect(key).toMatch(/^sign-in-email:[A-Za-z0-9_-]{22}$/);
    expect(key).not.toContain("person");
    expect(limitKey(LIMITS.signInEmail, "person@example.test")).toBe(key);
  });

  it("uses a day window for daily limits", async () => {
    const daily = limit(1, 24 * 60 * 60 * 1000);
    expect((await hit(ctx.db, daily, "d", NOW)).allowed).toBe(true);
    const refused = await hit(ctx.db, daily, "d", NOW);
    // Twelve hours less ten seconds to midnight UTC.
    expect(refused.retryAfterSeconds).toBe(12 * 3600 - 10);
  });
});

describe("hitAll", () => {
  it("allows only if every limit allows, and reports the longest wait", async () => {
    const perMinute = limit(2);
    const perHour = limit(3, 60 * 60 * 1000);
    const checks = [
      { limit: perMinute, subject: "u" },
      { limit: perHour, subject: "u" },
    ];
    const allowed = [];
    for (const time of [0, 1000, 2000, 61_000, 62_000]) {
      allowed.push((await hitAll(ctx.db, checks, at(time))).allowed);
    }
    // Two a minute, then the hour's three are used up.
    expect(allowed).toEqual([true, true, false, false, false]);
    const last = await hitAll(ctx.db, checks, at(63_000));
    expect(last.allowed).toBe(false);
    // The hour window (12:00 to 13:00) is the longer wait.
    expect(last.retryAfterSeconds).toBe(3600 - 73);
  });
});

describe("the wired limits", () => {
  it("limits sign-in links per IP, whatever the email", async () => {
    const results = [];
    for (let i = 0; i < 6; i++) {
      results.push(
        (
          await hitSignIn(ctx.db, {
            ip: "203.0.113.7",
            email: `p${i}@example.test`,
            now: NOW,
          })
        ).allowed,
      );
    }
    expect(results).toEqual([true, true, true, true, true, false]);
  });

  it("limits sign-in links per email, whatever the IP", async () => {
    const results = [];
    for (let i = 0; i < 6; i++) {
      results.push(
        (
          await hitSignIn(ctx.db, {
            ip: `198.51.100.${i}`,
            email: "target@example.test",
            now: NOW,
          })
        ).allowed,
      );
    }
    expect(results).toEqual([true, true, true, true, true, false]);
  });

  it("limits adding packages to 10 a minute and 100 a day", async () => {
    const minute = [];
    for (let i = 0; i < 11; i++) {
      minute.push((await hitAddPackage(ctx.db, "fast-adder", NOW)).allowed);
    }
    expect(minute.filter(Boolean)).toHaveLength(10);
    expect(minute[10]).toBe(false);

    // Ten a minute for ten minutes is the day's hundred; the next is refused.
    const day = [];
    for (let m = 0; m < 10; m++) {
      for (let i = 0; i < 10; i++) {
        day.push(
          (await hitAddPackage(ctx.db, "busy-adder", at(m * 60_000))).allowed,
        );
      }
    }
    expect(day.every(Boolean)).toBe(true);
    const next = await hitAddPackage(ctx.db, "busy-adder", at(10 * 60_000));
    expect(next.allowed).toBe(false);
  });
});

describe("cleanupRateLimits", () => {
  it("deletes only windows older than two days", async () => {
    const old = limit(5);
    const recent = limit(5);
    await hit(ctx.db, old, "c", new Date(NOW.getTime() - 3 * 86_400_000));
    await hit(ctx.db, recent, "c", new Date(NOW.getTime() - 86_400_000));

    const { deleted } = await cleanupRateLimits({ db: ctx.db, now: NOW });
    expect(deleted).toBeGreaterThanOrEqual(1);

    const keys = (await ctx.db.select().from(rateLimits)).map((r) => r.key);
    expect(keys).not.toContain(limitKey(old, "c"));
    expect(keys).toContain(limitKey(recent, "c"));
  });
});

describe("clientIp", () => {
  it("prefers x-real-ip, then the first x-forwarded-for entry", () => {
    expect(
      clientIp(
        new Headers({
          "x-real-ip": "203.0.113.1",
          "x-forwarded-for": "198.51.100.1",
        }),
      ),
    ).toBe("203.0.113.1");
    expect(
      clientIp(new Headers({ "x-forwarded-for": " 198.51.100.1 , 10.0.0.1" })),
    ).toBe("198.51.100.1");
  });

  it("falls back to unknown and caps the length", () => {
    expect(clientIp(new Headers())).toBe("unknown");
    expect(
      clientIp(new Headers({ "x-real-ip": "x".repeat(500) })),
    ).toHaveLength(64);
  });
});

describe("tooManyRequests", () => {
  it("answers 429 with Retry-After and no body", async () => {
    const response = tooManyRequests(42);
    expect(response.status).toBe(429);
    expect(response.headers.get("Retry-After")).toBe("42");
    expect(await response.text()).toBe("");
  });
});

describe("logLimited", () => {
  it("logs the action only", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    logLimited("sign-in");
    expect(warn).toHaveBeenCalledWith("rate limited", { action: "sign-in" });
    warn.mockRestore();
  });
});

describe("circuit breakers", () => {
  it("are not tripped until tripped, then stay tripped for the window", async () => {
    const breaker = BREAKERS.refetch;
    expect(await isBreakerTripped(ctx.db, breaker, "prov-a", NOW)).toBe(false);

    expect(await tripBreaker(ctx.db, breaker, "prov-a", NOW)).toEqual({
      first: true,
    });
    expect(await tripBreaker(ctx.db, breaker, "prov-a", at(1000))).toEqual({
      first: false,
    });
    expect(await isBreakerTripped(ctx.db, breaker, "prov-a", at(5000))).toBe(
      true,
    );
    // Another subject is unaffected, and the next hour starts clear.
    expect(await isBreakerTripped(ctx.db, breaker, "prov-b", NOW)).toBe(false);
    expect(
      await isBreakerTripped(ctx.db, breaker, "prov-a", at(60 * 60 * 1000)),
    ).toBe(false);
  });
});
