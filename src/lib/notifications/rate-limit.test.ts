// @vitest-environment node
import { describe, expect, it } from "vitest";
import { createRateLimiter } from "./rate-limit";

const at = (seconds: number) => new Date(Date.UTC(2026, 5, 20, 12, 0, seconds));

describe("createRateLimiter", () => {
  it("allows up to the limit within the window, then refuses", () => {
    const limiter = createRateLimiter({ limit: 3, windowMs: 60_000 });
    expect([0, 1, 2, 3, 4].map((s) => limiter.take("a", at(s)))).toEqual([
      true,
      true,
      true,
      false,
      false,
    ]);
  });

  it("allows again once the oldest use leaves the window", () => {
    const limiter = createRateLimiter({ limit: 2, windowMs: 60_000 });
    limiter.take("a", at(0));
    limiter.take("a", at(10));
    expect(limiter.take("a", at(30))).toBe(false);
    expect(limiter.take("a", at(61))).toBe(true); // the use at 0 expired
    expect(limiter.take("a", at(62))).toBe(false); // 10 and 61 still count
    expect(limiter.take("a", at(71))).toBe(true);
  });

  it("does not count refused attempts against the user", () => {
    const limiter = createRateLimiter({ limit: 1, windowMs: 60_000 });
    limiter.take("a", at(0));
    for (let s = 1; s < 50; s++) limiter.take("a", at(s));
    expect(limiter.take("a", at(61))).toBe(true);
  });

  it("keeps keys apart", () => {
    const limiter = createRateLimiter({ limit: 1, windowMs: 60_000 });
    expect(limiter.take("a", at(0))).toBe(true);
    expect(limiter.take("b", at(0))).toBe(true);
    expect(limiter.take("a", at(1))).toBe(false);
    expect(limiter.take("b", at(1))).toBe(false);
  });

  it("forgets keys that have gone quiet instead of growing for ever", () => {
    const limiter = createRateLimiter({ limit: 1, windowMs: 1000 });
    for (let i = 0; i < 1200; i++) limiter.take(`user-${i}`, at(0));
    // Much later, a fresh key triggers the clean-up; old keys can use it again.
    expect(limiter.take("fresh", at(100))).toBe(true);
    expect(limiter.take("user-0", at(100))).toBe(true);
  });
});
