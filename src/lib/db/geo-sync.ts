// SYSTEM-SCOPE queries for the geocoding jobs. They read place text from every
// user's live shipments to fill the global `places` cache, so, like
// tracker-sync.ts, they take no userId and ESLint only lets src/lib/geo and
// src/jobs import this module. They return location text and counts only;
// never shipment ids, tracking numbers, nicknames or anything about a user.
import { and, eq, isNotNull, isNull, min } from "drizzle-orm";
import type { Db } from "./client";
import { checkpoints, places, shipments } from "./schema";

export interface PendingPlace {
  /** The Postgres-computed cache key (checkpoints.location_key and friends). */
  key: string;
  /** One original spelling of the text, for the geocoder. */
  text: string;
}

/**
 * Distinct place keys, from live shipments' checkpoints and destinations, that
 * have no `places` row yet (a remembered miss counts as a row). Checkpoint
 * places come first because they place the icon; at most `limit` in total.
 */
export async function findPendingPlaces(
  db: Db,
  limit: number,
): Promise<PendingPlace[]> {
  const live = isNull(shipments.archivedAt);
  const uncached = isNull(places.id);

  const fromCheckpoints = await db
    .select({
      key: checkpoints.locationKey,
      text: min(checkpoints.locationText),
    })
    .from(checkpoints)
    .innerJoin(shipments, eq(checkpoints.shipmentId, shipments.id))
    .leftJoin(places, eq(places.queryKey, checkpoints.locationKey))
    .where(and(live, isNotNull(checkpoints.locationKey), uncached))
    .groupBy(checkpoints.locationKey)
    .limit(limit);

  const fromDestinations = await db
    .select({
      key: shipments.destinationKey,
      text: min(shipments.destinationText),
    })
    .from(shipments)
    .leftJoin(places, eq(places.queryKey, shipments.destinationKey))
    .where(and(live, isNotNull(shipments.destinationKey), uncached))
    .groupBy(shipments.destinationKey)
    .limit(limit);

  const seen = new Set<string>();
  const pending: PendingPlace[] = [];
  for (const row of [...fromCheckpoints, ...fromDestinations]) {
    if (!row.key || !row.text || seen.has(row.key)) continue;
    seen.add(row.key);
    pending.push({ key: row.key, text: row.text });
    if (pending.length >= limit) break;
  }
  return pending;
}

/** True if the key is cached, whether it was found or remembered as a miss. */
export async function hasPlace(db: Db, key: string): Promise<boolean> {
  const [row] = await db
    .select({ id: places.id })
    .from(places)
    .where(eq(places.queryKey, key));
  return row !== undefined;
}

/**
 * Caches a geocode answer; `null` records "looked up, nothing found". Safe to
 * call twice for the same key. Returns whether a row was written.
 */
export async function savePlace(
  db: Db,
  key: string,
  result: { lat: number; lng: number; displayName: string | null } | null,
  geocoder: string,
): Promise<boolean> {
  const inserted = await db
    .insert(places)
    .values({
      queryKey: key,
      lat: result?.lat ?? null,
      lng: result?.lng ?? null,
      displayName: result?.displayName ?? null,
      geocoder,
    })
    .onConflictDoNothing({ target: places.queryKey })
    .returning({ id: places.id });
  return inserted.length > 0;
}
