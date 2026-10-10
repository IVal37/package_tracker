import { getDb } from "@/lib/db/client";
import { getEnv } from "@/lib/env";
import { archiveDeliveredShipments } from "@/lib/shipments/sync/archive-delivered";
import { expireQuietShipments } from "@/lib/shipments/sync/expire-quiet";
import { inngest } from "./client";

/** Daily: take shipments delivered (or expired) 14+ days ago off the list. */
export const archiveDelivered = inngest.createFunction(
  {
    id: "archive-delivered-shipments",
    triggers: { cron: "TZ=UTC 30 3 * * *" },
    concurrency: 1,
  },
  async ({ step }) =>
    step.run("archive", () =>
      archiveDeliveredShipments({
        db: getDb(),
        now: new Date(),
        expireAfterDays: getEnv().EXPIRE_AFTER_DAYS,
      }),
    ),
);

/** Daily, before the archive: mark shipments with no news for N days Expired. */
export const expireQuiet = inngest.createFunction(
  {
    id: "expire-quiet-shipments",
    triggers: { cron: "TZ=UTC 20 3 * * *" },
    concurrency: 1,
  },
  async ({ step }) =>
    step.run("expire", () =>
      expireQuietShipments({
        db: getDb(),
        now: new Date(),
        expireAfterDays: getEnv().EXPIRE_AFTER_DAYS,
      }),
    ),
);
