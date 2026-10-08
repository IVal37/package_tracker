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
  notInArray,
} from "drizzle-orm";
import { decideShipmentUpdate } from "@/lib/shipments/sync/decide-update";
import type { NormalizedShipment } from "@/lib/tracking/types";
import { insertCheckpoints } from "./checkpoints";
import type { Db } from "./client";
import { shipments } from "./schema";

/** A shipment with no provider sync for this long is re-fetched. */
export const STALE_AFTER_MS = 24 * 60 * 60 * 1000;

/** Statuses that are never re-fetched. */
const TERMINAL = ["Delivered", "Expired"] as const;

export interface ApplyTrackerResult {
  shipments: number;
  newCheckpoints: number;
}

/**
 * Applies one provider update to every shipment that uses that tracker. The
 * rows are locked for the transaction, so two concurrent updates for the same
 * tracker apply one after the other. Checkpoints are always stored (de-duplicated
 * by provider event id); the status moves only per decideShipmentUpdate.
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
        status: shipments.status,
        eta: shipments.eta,
        lastEventAt: shipments.lastEventAt,
      })
      .from(shipments)
      .where(
        and(
          eq(shipments.provider, provider),
          eq(shipments.providerTrackerId, incoming.providerTrackerId),
        ),
      )
      .orderBy(asc(shipments.id)) // same lock order everywhere: no deadlocks
      .for("update");

    let newCheckpoints = 0;
    for (const row of rows) {
      newCheckpoints += await insertCheckpoints(tx, row.id, incoming.events);
      await tx
        .update(shipments)
        .set({
          ...decideShipmentUpdate(row, incoming, now),
          updatedAt: now,
          // A provider that drops the destination doesn't erase what we have.
          ...(incoming.destination && {
            destinationText: incoming.destination,
          }),
        })
        .where(eq(shipments.id, row.id));
    }
    return { shipments: rows.length, newCheckpoints };
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
  const cutoff = new Date(now.getTime() - STALE_AFTER_MS);
  const oldestSync = min(shipments.lastSyncedAt);

  const rows = await db
    .select({ trackerId: shipments.providerTrackerId })
    .from(shipments)
    .where(
      and(
        eq(shipments.provider, provider),
        isNotNull(shipments.providerTrackerId),
        isNull(shipments.archivedAt),
        notInArray(shipments.status, [...TERMINAL]),
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
    .where(
      and(
        eq(shipments.provider, provider),
        eq(shipments.providerTrackerId, trackerId),
      ),
    );
}

/** Archives Delivered shipments whose last event is at or before the cutoff. */
export async function archiveDeliveredBefore(
  db: Db,
  cutoff: Date,
  now: Date,
): Promise<number> {
  const archived = await db
    .update(shipments)
    .set({ archivedAt: now, updatedAt: now })
    .where(
      and(
        eq(shipments.status, "Delivered"),
        isNull(shipments.archivedAt),
        lte(shipments.lastEventAt, cutoff),
      ),
    )
    .returning({ id: shipments.id });
  return archived.length;
}
