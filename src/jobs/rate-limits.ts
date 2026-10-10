import { getDb } from "@/lib/db/client";
import { cleanupRateLimits } from "@/lib/ratelimit";
import { inngest } from "./client";

/** Daily: deletes rate-limit windows older than any limit needs. */
export const rateLimitsCleanup = inngest.createFunction(
  {
    id: "rate-limits-cleanup",
    triggers: { cron: "TZ=UTC 0 4 * * *" },
    concurrency: 1,
  },
  async ({ step }) =>
    step.run("cleanup", () =>
      cleanupRateLimits({ db: getDb(), now: new Date() }),
    ),
);
