import { getDb } from "@/lib/db/client";
import { archiveDeliveredShipments } from "@/lib/shipments/sync/archive-delivered";
import { inngest } from "./client";

/** Daily: take shipments delivered 14+ days ago off the list. */
export const archiveDelivered = inngest.createFunction(
  {
    id: "archive-delivered-shipments",
    triggers: { cron: "TZ=UTC 30 3 * * *" },
    concurrency: 1,
  },
  async ({ step }) =>
    step.run("archive", () =>
      archiveDeliveredShipments({ db: getDb(), now: new Date() }),
    ),
);
