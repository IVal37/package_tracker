// A small in-memory limiter: at most `limit` uses per `windowMs` per key.
// It lives in one server process, so on a serverless host each instance counts
// for itself and the limit is only approximate. That is enough to stop a
// button being hammered; real rate limiting for public endpoints is Phase 7.

export interface RateLimiter {
  /** Records a use and returns true, or returns false if the key is over its limit. */
  take(key: string, now: Date): boolean;
}

export function createRateLimiter(options: {
  limit: number;
  windowMs: number;
}): RateLimiter {
  const uses = new Map<string, number[]>();

  return {
    take(key, now) {
      const cutoff = now.getTime() - options.windowMs;
      const recent = (uses.get(key) ?? []).filter((time) => time > cutoff);
      if (recent.length >= options.limit) {
        uses.set(key, recent);
        return false;
      }
      recent.push(now.getTime());
      uses.set(key, recent);

      // Forget keys that have gone quiet, so the map does not grow for ever.
      if (uses.size > 1000) {
        for (const [other, times] of uses) {
          if (times.every((time) => time <= cutoff)) uses.delete(other);
        }
      }
      return true;
    },
  };
}
