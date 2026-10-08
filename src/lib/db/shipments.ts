// Every function here takes userId and filters by it. There is deliberately no
// unscoped way to read or change a shipment: a shipment that belongs to someone
// else is indistinguishable from one that does not exist.
import { and, asc, desc, eq, getTableColumns, isNull, sql } from "drizzle-orm";
import type { NormalizedEvent } from "@/lib/tracking/types";
import { insertCheckpoints } from "./checkpoints";
import type { Db } from "./client";
import { checkpoints, places, shipments } from "./schema";

export type ShipmentRow = typeof shipments.$inferSelect;
export type CheckpointRow = typeof checkpoints.$inferSelect;
/** A checkpoint with coordinates from the places cache (null if not geocoded). */
export type CheckpointDetail = CheckpointRow & {
  lat: number | null;
  lng: number | null;
};

export interface ShipmentListItem extends ShipmentRow {
  lastCheckpoint: {
    message: string | null;
    locationText: string | null;
    occurredAt: Date;
  } | null;
}

export interface ShipmentDetail {
  shipment: ShipmentRow;
  /** Newest first. */
  checkpoints: CheckpointDetail[];
}

export type NewShipment = Pick<
  typeof shipments.$inferInsert,
  | "trackingNumber"
  | "courier"
  | "nickname"
  | "provider"
  | "providerTrackerId"
  | "status"
  | "eta"
  | "lastEventAt"
  | "destinationText"
>;

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Postgres rejects a malformed uuid with an error; treat it as "not found". */
const isUuid = (value: string) => UUID.test(value);

/** True for a Postgres unique-constraint violation, however the driver wraps it. */
export function isUniqueViolation(error: unknown): boolean {
  const code = (e: unknown) =>
    typeof e === "object" && e !== null && "code" in e
      ? (e as { code: unknown }).code
      : undefined;
  const cause =
    typeof error === "object" && error !== null && "cause" in error
      ? (error as { cause: unknown }).cause
      : undefined;
  return code(error) === "23505" || code(cause) === "23505";
}

/** The user's non-archived shipments, each with its most recent checkpoint. */
export async function listShipments(
  db: Db,
  userId: string,
): Promise<ShipmentListItem[]> {
  const owned = and(eq(shipments.userId, userId), isNull(shipments.archivedAt));

  const rows = await db
    .select()
    .from(shipments)
    .where(owned)
    .orderBy(desc(shipments.createdAt));

  const latest = await db
    .selectDistinctOn([checkpoints.shipmentId], {
      shipmentId: checkpoints.shipmentId,
      message: checkpoints.message,
      locationText: checkpoints.locationText,
      occurredAt: checkpoints.occurredAt,
    })
    .from(checkpoints)
    .innerJoin(shipments, eq(checkpoints.shipmentId, shipments.id))
    .where(owned)
    .orderBy(
      checkpoints.shipmentId,
      desc(checkpoints.occurredAt),
      sql`${checkpoints.eventOrder} desc nulls last`,
    );

  const byShipment = new Map(latest.map((c) => [c.shipmentId, c]));
  return rows.map((row) => {
    const last = byShipment.get(row.id);
    return {
      ...row,
      lastCheckpoint: last
        ? {
            message: last.message,
            locationText: last.locationText,
            occurredAt: last.occurredAt,
          }
        : null,
    };
  });
}

export async function getShipment(
  db: Db,
  userId: string,
  shipmentId: string,
): Promise<ShipmentRow | null> {
  if (!isUuid(shipmentId)) return null;
  const [row] = await db
    .select()
    .from(shipments)
    .where(and(eq(shipments.id, shipmentId), eq(shipments.userId, userId)));
  return row ?? null;
}

export async function getShipmentDetail(
  db: Db,
  userId: string,
  shipmentId: string,
): Promise<ShipmentDetail | null> {
  const shipment = await getShipment(db, userId, shipmentId);
  if (!shipment) return null;

  // Coordinates come from the global places cache; null until geocoded (or
  // for good, if the place could not be found).
  const timeline = await db
    .select({
      ...getTableColumns(checkpoints),
      lat: places.lat,
      lng: places.lng,
    })
    .from(checkpoints)
    .leftJoin(places, eq(places.queryKey, checkpoints.locationKey))
    .where(eq(checkpoints.shipmentId, shipment.id))
    .orderBy(
      desc(checkpoints.occurredAt),
      sql`${checkpoints.eventOrder} desc nulls last`,
    );
  return { shipment, checkpoints: timeline };
}

export interface MapCheckpoint {
  status: CheckpointRow["status"];
  message: string | null;
  locationText: string | null;
  occurredAt: Date;
  /** Null when the place is not geocoded yet, or could not be found. */
  point: { lat: number; lng: number } | null;
}

export interface MapShipment {
  id: string;
  /** Nickname, or the tracking number. */
  name: string;
  status: ShipmentRow["status"];
  /** Where it is going, if that has been geocoded. */
  destination: { lat: number; lng: number } | null;
  /** Oldest first. */
  checkpoints: MapCheckpoint[];
}

const toPoint = (lat: number | null, lng: number | null) =>
  lat !== null && lng !== null ? { lat, lng } : null;

/**
 * The user's non-archived shipments with everything the map needs: each
 * checkpoint (oldest first) and the destination, with coordinates joined from
 * the places cache. Both queries are scoped to the user.
 */
export async function listMapShipments(
  db: Db,
  userId: string,
): Promise<MapShipment[]> {
  const owned = and(eq(shipments.userId, userId), isNull(shipments.archivedAt));

  const rows = await db
    .select({
      id: shipments.id,
      nickname: shipments.nickname,
      trackingNumber: shipments.trackingNumber,
      status: shipments.status,
      destLat: places.lat,
      destLng: places.lng,
    })
    .from(shipments)
    .leftJoin(places, eq(places.queryKey, shipments.destinationKey))
    .where(owned)
    .orderBy(desc(shipments.createdAt));

  const events = await db
    .select({
      shipmentId: checkpoints.shipmentId,
      status: checkpoints.status,
      message: checkpoints.message,
      locationText: checkpoints.locationText,
      occurredAt: checkpoints.occurredAt,
      lat: places.lat,
      lng: places.lng,
    })
    .from(checkpoints)
    .innerJoin(shipments, eq(checkpoints.shipmentId, shipments.id))
    .leftJoin(places, eq(places.queryKey, checkpoints.locationKey))
    .where(owned)
    .orderBy(
      asc(checkpoints.occurredAt),
      sql`${checkpoints.eventOrder} asc nulls first`,
    );

  const byShipment = new Map<string, MapCheckpoint[]>();
  for (const event of events) {
    const list = byShipment.get(event.shipmentId) ?? [];
    list.push({
      status: event.status,
      message: event.message,
      locationText: event.locationText,
      occurredAt: event.occurredAt,
      point: toPoint(event.lat, event.lng),
    });
    byShipment.set(event.shipmentId, list);
  }

  return rows.map((row) => ({
    id: row.id,
    name: row.nickname ?? row.trackingNumber,
    status: row.status,
    destination: toPoint(row.destLat, row.destLng),
    checkpoints: byShipment.get(row.id) ?? [],
  }));
}

export async function findShipmentByTrackingNumber(
  db: Db,
  userId: string,
  trackingNumber: string,
): Promise<ShipmentRow | null> {
  const [row] = await db
    .select()
    .from(shipments)
    .where(
      and(
        eq(shipments.userId, userId),
        eq(shipments.trackingNumber, trackingNumber),
      ),
    );
  return row ?? null;
}

/** Inserts the shipment and its checkpoints atomically; returns the new id. */
export async function createShipmentWithCheckpoints(
  db: Db,
  userId: string,
  data: NewShipment,
  events: NormalizedEvent[],
): Promise<string> {
  return db.transaction(async (tx) => {
    const [created] = await tx
      .insert(shipments)
      .values({ ...data, userId })
      .returning({ id: shipments.id });
    if (!created) throw new Error("Shipment insert returned no row");

    await insertCheckpoints(tx, created.id, events);
    return created.id;
  });
}

/** Deletes one of the user's shipments. False if it is missing or not theirs. */
export async function deleteShipment(
  db: Db,
  userId: string,
  shipmentId: string,
): Promise<boolean> {
  if (!isUuid(shipmentId)) return false;
  const deleted = await db
    .delete(shipments)
    .where(and(eq(shipments.id, shipmentId), eq(shipments.userId, userId)))
    .returning({ id: shipments.id });
  return deleted.length > 0;
}
