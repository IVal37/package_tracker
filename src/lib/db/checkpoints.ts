import type { NormalizedEvent } from "@/lib/tracking/types";
import type { Db } from "./client";
import { checkpoints } from "./schema";

/**
 * Inserts events for a shipment, skipping any already stored (unique on
 * shipment_id + provider_event_id). Returns how many rows were actually new.
 */
export async function insertCheckpoints(
  db: Db,
  shipmentId: string,
  events: NormalizedEvent[],
): Promise<number> {
  if (events.length === 0) return 0;

  const inserted = await db
    .insert(checkpoints)
    .values(
      events.map((event) => ({
        shipmentId,
        providerEventId: event.providerEventId,
        occurredAt: event.occurredAt,
        eventOrder: event.order,
        status: event.status,
        message: event.message,
        locationText: event.locationText,
      })),
    )
    .onConflictDoNothing({
      target: [checkpoints.shipmentId, checkpoints.providerEventId],
    })
    .returning({ id: checkpoints.id });

  return inserted.length;
}
