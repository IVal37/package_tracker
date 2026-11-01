// SYSTEM-SCOPE queries for webhooks and background jobs. Unlike shipments.ts,
// nothing here takes a userId: provider updates are keyed by tracker id, and one
// tracker can be shared by several users. Because of that, ESLint only lets
// src/lib/shipments/sync/** and src/jobs/** import this module. It applies
// updates and returns counts; it must never return shipment data to a caller
// that renders it.
import {
  and,
  asc,
  eq,
  isNotNull,
  isNull,
  lt,
  lte,
  min,
  ne,
  notInArray,
  sql,
  type SQL,
} from "drizzle-orm";
import { alertsForUpdate } from "@/lib/notifications/rules";
import { decideShipmentUpdate } from "@/lib/shipments/sync/decide-update";
import { DAY_MS, msBefore } from "@/lib/time";
import { FINISHED_STATUSES } from "@/lib/tracking/status";
import type { NormalizedShipment } from "@/lib/tracking/types";
import { insertCheckpoints } from "./checkpoints";
import type { Db } from "./client";
import { notifications, shipments } from "./schema";

/** A shipment with no provider sync for this long is re-fetched. */
export const STALE_AFTER_MS = DAY_MS;

/** Every shipment on one provider tracker. */
const onTracker = (provider: string, trackerId: string) =>
  and(
    eq(shipments.provider, provider),
    eq(shipments.providerTrackerId, trackerId),
  );

export interface ApplyTrackerResult {
  shipments: number;
  newCheckpoints: number;
  /** Alerts recorded by this update, to be delivered by a background job. */
  notificationIds: string[];
}

/**
 * Applies one provider update to every shipment that uses that tracker. The
 * rows are locked for the transaction, so two concurrent updates for the same
 * tracker apply one after the other. Checkpoints are always stored (de-duplicated
 * by provider event id); the status moves only per decideShipmentUpdate.
 *
 * The alerts the change earns (see alertsForUpdate) are recorded in the same
 * transaction, so an update that fails records none, and an update repeated
 * records none twice: the notifications table is unique per event. Only ids
 * leave this module; the job that delivers them reads everything else itself.
 */
export async function applyTrackerUpdate(
  db: Db,
  provider: string,
  incoming: NormalizedShipment,
  now: Date,
): Promise<ApplyTrackerResult> {
  return db.transaction(async (tx) => {
    const rows = await tx
      .select({
        id: shipments.id,
        userId: shipments.userId,
        status: shipments.status,
        eta: shipments.eta,
        lastEventAt: shipments.lastEventAt,
        archivedAt: shipments.archivedAt,
      })
      .from(shipments)
      .where(onTracker(provider, incoming.providerTrackerId))
      .orderBy(asc(shipments.id)) // same lock order everywhere: no deadlocks
      .for("update");

    let newCheckpoints = 0;
    const notificationIds: string[] = [];
    for (const row of rows) {
      newCheckpoints += await insertCheckpoints(tx, row.id, incoming.events);
      const decided = decideShipmentUpdate(row, incoming, now);
      await tx
        .update(shipments)
        .set({
          ...decided,
          updatedAt: now,
          // A provider that drops the destination doesn't erase what we have.
          ...(incoming.destination && {
            destinationText: incoming.destination,
          }),
        })
        .where(eq(shipments.id, row.id));

      // Archived shipments are out of sight; they never alert.
      const alerts = row.archivedAt ? [] : alertsForUpdate(row, decided);
      if (alerts.length > 0) {
        const recorded = await tx
          .insert(notifications)
          .values(
            alerts.map((alert) => ({
              userId: row.userId,
              shipmentId: row.id,
              kind: alert.kind,
              dedupeKey: alert.dedupeKey,
            })),
          )
          .onConflictDoNothing()
          .returning({ id: notifications.id });
        notificationIds.push(...recorded.map((r) => r.id));
      }
    }
    return { shipments: rows.length, newCheckpoints, notificationIds };
  });
}

/**
 * Tracker ids to re-fetch: this provider's non-archived, non-terminal shipments
 * not synced for STALE_AFTER_MS, oldest first. A tracker shared by several
 * shipments appears once.
 */
export async function findStaleTrackers(
  db: Db,
  provider: string,
  now: Date,
  limit: number,
): Promise<string[]> {
  const cutoff = msBefore(now, STALE_AFTER_MS);
  const oldestSync = min(shipments.lastSyncedAt);

  const rows = await db
    .select({ trackerId: shipments.providerTrackerId })
    .from(shipments)
    .where(
      and(
        eq(shipments.provider, provider),
        isNotNull(shipments.providerTrackerId),
        isNull(shipments.archivedAt),
        notInArray(shipments.status, [...FINISHED_STATUSES]),
        lt(shipments.lastSyncedAt, cutoff),
      ),
    )
    .groupBy(shipments.providerTrackerId)
    .orderBy(asc(oldestSync))
    .limit(limit);

  return rows.flatMap((row) => (row.trackerId ? [row.trackerId] : []));
}

/** Records that we asked the provider about a tracker, whatever the answer. */
export async function markTrackerSynced(
  db: Db,
  provider: string,
  trackerId: string,
  now: Date,
): Promise<void> {
  await db
    .update(shipments)
    .set({ lastSyncedAt: now })
    .where(onTracker(provider, trackerId));
}

/**
 * Whether anyone other than this user still has a shipment on the tracker. A
 * tracker is shared by every user who added the same number, so it may only be
 * unsubscribed when the answer is false. Returns the answer only.
 */
export async function isTrackerFollowedByOthers(
  db: Db,
  provider: string,
  trackerId: string,
  userId: string,
): Promise<boolean> {
  const [row] = await db
    .select({ id: shipments.id })
    .from(shipments)
    .where(and(onTracker(provider, trackerId), ne(shipments.userId, userId)))
    .limit(1);
  return row !== undefined;
}

/** Archives the shipments that match and are not archived yet. Returns how many. */
async function archiveWhere(
  db: Db,
  due: SQL | undefined,
  now: Date,
): Promise<number> {
  const archived = await db
    .update(shipments)
    .set({ archivedAt: now, updatedAt: now })
    .where(and(isNull(shipments.archivedAt), due))
    .returning({ id: shipments.id });
  return archived.length;
}

/** Archives Delivered shipments whose last event is at or before the cutoff. */
export function archiveDeliveredBefore(
  db: Db,
  cutoff: Date,
  now: Date,
): Promise<number> {
  return archiveWhere(
    db,
    and(eq(shipments.status, "Delivered"), lte(shipments.lastEventAt, cutoff)),
    now,
  );
}

/** When a shipment last heard anything: its newest event, or when it was added. */
const quietSince = sql`coalesce(${shipments.lastEventAt}, ${shipments.createdAt})`;

/**
 * Marks live shipments Expired when nothing has been heard since the cutoff
 * (shipments_expire_due_idx). Delivered and archived shipments are never
 * touched. Returns how many expired. No alert is recorded for expiring.
 */
export async function expireQuietBefore(
  db: Db,
  cutoff: Date,
  now: Date,
): Promise<number> {
  const expired = await db
    .update(shipments)
    .set({ status: "Expired", updatedAt: now })
    .where(
      and(
        isNull(shipments.archivedAt),
        notInArray(shipments.status, [...FINISHED_STATUSES]),
        lt(quietSince, cutoff),
      ),
    )
    .returning({ id: shipments.id });
  return expired.length;
}

/** Archives Expired shipments quiet since at or before the cutoff. */
export function archiveExpiredBefore(
  db: Db,
  cutoff: Date,
  now: Date,
): Promise<number> {
  return archiveWhere(
    db,
    and(eq(shipments.status, "Expired"), lte(quietSince, cutoff)),
    now,
  );
}
