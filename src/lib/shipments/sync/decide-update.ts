import type { NormalizedShipment, Status } from "@/lib/tracking";

export interface ShipmentState {
  status: Status;
  eta: Date | null;
  lastEventAt: Date | null;
}

export interface ShipmentUpdate extends ShipmentState {
  lastSyncedAt: Date;
}

const newestEventTime = (incoming: NormalizedShipment): Date | null =>
  incoming.events.reduce<Date | null>(
    (newest, event) =>
      newest === null || event.occurredAt > newest ? event.occurredAt : newest,
    null,
  );

/**
 * Decides what a provider update does to a stored shipment.
 *
 * Webhooks can arrive out of order, so "newer" is decided by event time, not
 * by ranking statuses (AttemptFail -> OutForDelivery and Exception -> InTransit
 * are legitimate moves). The incoming status and ETA win only when the incoming
 * newest event is at least as new as the stored last event; an equal time wins
 * so a repeated delivery is a harmless no-op. An update with no events only
 * applies to a shipment that has no history yet. last_event_at never moves
 * backwards, and last_synced_at is always bumped.
 */
export function decideShipmentUpdate(
  current: ShipmentState,
  incoming: NormalizedShipment,
  now: Date,
): ShipmentUpdate {
  const incomingNewest = newestEventTime(incoming);

  const isCurrent =
    current.lastEventAt === null ||
    (incomingNewest !== null && incomingNewest >= current.lastEventAt);

  const lastEventAt =
    current.lastEventAt !== null &&
    (incomingNewest === null || current.lastEventAt > incomingNewest)
      ? current.lastEventAt
      : incomingNewest;

  return {
    status: isCurrent ? incoming.status : current.status,
    eta: isCurrent ? incoming.eta : current.eta,
    lastEventAt,
    lastSyncedAt: now,
  };
}
