// SYSTEM-SCOPE queries for the notification jobs. They act for no signed-in
// user: the hourly scan looks at every user's shipments, and delivery loads an
// alert by id. Like tracker-sync.ts, ESLint only lets src/lib/notifications and
// src/jobs import this module. It records alerts and returns ids and counts; it
// never returns shipment contents to anything that renders them.
import {
  and,
  asc,
  eq,
  gt,
  isNotNull,
  isNull,
  lt,
  lte,
  notInArray,
  sql,
} from "drizzle-orm";
import { overdueDedupeKey, overdueWindow } from "@/lib/notifications/rules";
import type { Db } from "./client";
import { notifications, shipments } from "./schema";
import { isUuid } from "./shipments";

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

/** The part of an alert delivery needs: who it is for and about, and its state. */
export interface NotificationRef {
  id: string;
  userId: string;
  shipmentId: string;
  kind: (typeof notifications.$inferSelect)["kind"];
  status: (typeof notifications.$inferSelect)["status"];
  createdAt: Date;
}

/** One alert by id, or null if there is none (or the id is malformed). */
export async function loadNotification(
  db: Db,
  id: string,
): Promise<NotificationRef | null> {
  if (!isUuid(id)) return null;
  const [row] = await db
    .select({
      id: notifications.id,
      userId: notifications.userId,
      shipmentId: notifications.shipmentId,
      kind: notifications.kind,
      status: notifications.status,
      createdAt: notifications.createdAt,
    })
    .from(notifications)
    .where(eq(notifications.id, id));
  return row ?? null;
}

/** Is there a later alert for the same shipment? Then this one is out of date. */
export async function hasNewerNotification(
  db: Db,
  notification: Pick<NotificationRef, "id" | "shipmentId" | "createdAt">,
): Promise<boolean> {
  const [row] = await db
    .select({ id: notifications.id })
    .from(notifications)
    .where(
      and(
        eq(notifications.shipmentId, notification.shipmentId),
        gt(notifications.createdAt, notification.createdAt),
      ),
    )
    .limit(1);
  return row !== undefined;
}

export interface NotificationOutcome {
  status: "sent" | "skipped" | "failed";
  skipReason?: string;
  pushSent: boolean;
  emailSent: boolean;
}

/**
 * Records what became of a pending alert. Does nothing, and says so, if it was
 * already finished: a second run can never overwrite the first's outcome.
 */
export async function finishNotification(
  db: Db,
  id: string,
  outcome: NotificationOutcome,
  now: Date,
): Promise<boolean> {
  if (!isUuid(id)) return false;
  const updated = await db
    .update(notifications)
    .set({
      status: outcome.status,
      skipReason: outcome.skipReason ?? null,
      pushSent: outcome.pushSent,
      emailSent: outcome.emailSent,
      sentAt: outcome.status === "sent" ? now : null,
    })
    .where(and(eq(notifications.id, id), eq(notifications.status, "pending")))
    .returning({ id: notifications.id });
  return updated.length > 0;
}

/**
 * Ids of alerts still pending after `olderThan`: their delivery event was lost
 * (or they are waiting out quiet hours; the job ignores those it finds done).
 */
export async function findPendingNotificationIds(
  db: Db,
  olderThan: Date,
  limit: number,
): Promise<string[]> {
  const rows = await db
    .select({ id: notifications.id })
    .from(notifications)
    .where(
      and(
        eq(notifications.status, "pending"),
        lt(notifications.createdAt, olderThan),
      ),
    )
    .orderBy(asc(notifications.createdAt))
    .limit(limit);
  return rows.map((row) => row.id);
}

/** Deletes alerts created before the cutoff, whatever became of them. */
export async function deleteNotificationsBefore(
  db: Db,
  cutoff: Date,
): Promise<number> {
  const deleted = await db
    .delete(notifications)
    .where(lt(notifications.createdAt, cutoff))
    .returning({ id: notifications.id });
  return deleted.length;
}
