import type { Db } from "@/lib/db/client";
import { deleteShipment, getShipment } from "@/lib/db/shipments";
import { TrackerNotFoundError, type TrackingProvider } from "@/lib/tracking";

export type RemoveShipmentResult =
  { ok: true } | { ok: false; error: "not_found" };

/**
 * Stops tracking and deletes the user's shipment. A shipment that is missing
 * or belongs to someone else is "not_found". Provider failures never block the
 * delete, so users can always remove a package.
 */
export async function removeShipment(params: {
  db: Db;
  provider: TrackingProvider;
  userId: string;
  shipmentId: string;
}): Promise<RemoveShipmentResult> {
  const { db, provider, userId, shipmentId } = params;

  const shipment = await getShipment(db, userId, shipmentId);
  if (!shipment) return { ok: false, error: "not_found" };

  // Only ask the provider that owns the tracker (rows may predate a provider
  // switch, e.g. fake in development, ship24 in production).
  if (shipment.providerTrackerId && shipment.provider === provider.name) {
    try {
      await provider.deleteTracking(shipment.providerTrackerId);
    } catch (error) {
      if (!(error instanceof TrackerNotFoundError)) {
        const name = error instanceof Error ? error.name : "unknown error";
        console.error(`[removeShipment] provider failure: ${name}`);
      }
    }
  }

  const deleted = await deleteShipment(db, userId, shipmentId);
  return deleted ? { ok: true } : { ok: false, error: "not_found" };
}
