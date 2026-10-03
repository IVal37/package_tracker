import type { Status } from "@/lib/tracking";

/** Most urgent first. Delivered and Expired sink to the bottom. */
export const STATUS_DISPLAY_ORDER: readonly Status[] = [
  "OutForDelivery",
  "AttemptFail",
  "Exception",
  "AvailableForPickup",
  "InTransit",
  "InfoReceived",
  "Pending",
  "Delivered",
  "Expired",
];

export const STATUS_LABELS: Record<Status, string> = {
  Pending: "Pending",
  InfoReceived: "Info received",
  InTransit: "In transit",
  OutForDelivery: "Out for delivery",
  AttemptFail: "Delivery attempted",
  Delivered: "Delivered",
  AvailableForPickup: "Ready for pickup",
  Exception: "Exception",
  Expired: "Expired",
};

export interface Sortable {
  eta: Date | null;
  lastEventAt: Date | null;
  createdAt: Date;
}

/** Null sorts last. */
function compareNullable(a: Date | null, b: Date | null, direction: 1 | -1) {
  if (a && b) return direction * (a.getTime() - b.getTime());
  if (a) return -1;
  if (b) return 1;
  return 0;
}

/**
 * Within a group: soonest ETA first (no ETA last), then most recent activity,
 * then most recently added.
 */
export function compareShipments(a: Sortable, b: Sortable): number {
  return (
    compareNullable(a.eta, b.eta, 1) ||
    compareNullable(a.lastEventAt, b.lastEventAt, -1) ||
    b.createdAt.getTime() - a.createdAt.getTime()
  );
}

export interface ShipmentGroup<T> {
  status: Status;
  label: string;
  shipments: T[];
}

/** Ordered, non-empty status groups with each group sorted. Does not mutate. */
export function groupShipmentsByStatus<T extends Sortable & { status: Status }>(
  shipments: readonly T[],
): ShipmentGroup<T>[] {
  return STATUS_DISPLAY_ORDER.flatMap((status) => {
    const inGroup = shipments
      .filter((shipment) => shipment.status === status)
      .sort(compareShipments);
    return inGroup.length > 0
      ? [{ status, label: STATUS_LABELS[status], shipments: inGroup }]
      : [];
  });
}
