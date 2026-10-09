// SYSTEM-SCOPE queries for the notification jobs. They act for no signed-in
// user: the hourly scan looks at every user's shipments, and delivery loads an
// alert by id. Like tracker-sync.ts, ESLint only lets src/lib/notifications and
// src/jobs import this module. It records alerts and returns ids and counts; it
// never returns shipment contents to anything that renders them.
import {
  and,
  asc,
  gt,
  isNotNull,
  isNull,
  lte,
  notInArray,
  sql,
} from "drizzle-orm";
import { overdueDedupeKey, overdueWindow } from "@/lib/notifications/rules";
import type { Db } from "./client";
import { notifications, shipments } from "./schema";

/** Statuses for which an old ETA means nothing (see isOverdue). */
const NEVER_OVERDUE = ["Delivered", "Expired", "AvailableForPickup"] as const;

/**
 * Records a "delay" alert for every live shipment whose ETA passed more than a
 * day ago (within the last 14 days) and that has none for that promised day.
 * Returns the ids of the alerts it recorded, oldest ETA first. Running it again
 * records nothing: the unique key is (shipment, kind, promised day).
 */
export async function insertOverdueAlerts(
  db: Db,
  now: Date,
  limit: number,
): Promise<string[]> {
  const { from, to } = overdueWindow(now);

  const candidates = await db
    .select({
      id: shipments.id,
      userId: shipments.userId,
      eta: shipments.eta,
    })
    .from(shipments)
    .where(
      and(
        isNull(shipments.archivedAt),
        isNotNull(shipments.eta),
        gt(shipments.eta, from),
        lte(shipments.eta, to),
        notInArray(shipments.status, [...NEVER_OVERDUE]),
        // Skip the ones already alerted for this promised day, so a large
        // backlog of old alerts cannot crowd out new ones.
        sql`not exists (
          select 1 from ${notifications} n
           where n.shipment_id = ${shipments.id}
             and n.kind = 'delay'
             and n.dedupe_key = 'overdue:' || to_char(${shipments.eta} at time zone 'UTC', 'YYYY-MM-DD')
        )`,
      ),
    )
    .orderBy(asc(shipments.eta))
    .limit(limit);

  const rows = candidates.flatMap((row) =>
    row.eta
      ? [
          {
            userId: row.userId,
            shipmentId: row.id,
            kind: "delay" as const,
            dedupeKey: overdueDedupeKey(row.eta),
          },
        ]
      : [],
  );
  if (rows.length === 0) return [];

  const recorded = await db
    .insert(notifications)
    .values(rows)
    .onConflictDoNothing()
    .returning({ id: notifications.id });
  return recorded.map((row) => row.id);
}
