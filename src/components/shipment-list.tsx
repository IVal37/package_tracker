import Link from "next/link";
import type { ShipmentListItem } from "@/lib/db/shipments";
import { formatEta, formatRelativeTime } from "@/lib/shipments/format";
import type { ShipmentGroup } from "@/lib/shipments/grouping";
import { StatusChip } from "./status-chip";

/** What the list needs to show an order that has no shipment yet. */
export interface OrderedItem {
  id: string;
  retailer: string | null;
  item: string | null;
  orderNumber: string | null;
  createdAt: Date;
}

interface ShipmentListProps {
  groups: ShipmentGroup<ShipmentListItem>[];
  now: Date;
  /** Orders still waiting for their shipping email. */
  orders?: OrderedItem[];
  dismissOrderAction?: (formData: FormData) => Promise<void>;
}

/** Where the "Ordered" section goes: just before Delivered, else at the end. */
function orderedIndex(groups: ShipmentGroup<ShipmentListItem>[]): number {
  const index = groups.findIndex(
    (group) => group.status === "Delivered" || group.status === "Expired",
  );
  return index === -1 ? groups.length : index;
}

export function ShipmentList({
  groups,
  now,
  orders = [],
  dismissOrderAction,
}: ShipmentListProps) {
  if (groups.length === 0 && orders.length === 0) {
    return (
      <p className="rounded-lg border border-dashed border-slate-300 p-8 text-center text-slate-500">
        No packages yet — add a tracking number above.
      </p>
    );
  }

  const split = orderedIndex(groups);
  const ordered = orders.length > 0 && (
    <OrderedSection
      key="ordered"
      orders={orders}
      now={now}
      dismissAction={dismissOrderAction}
    />
  );

  return (
    <div className="space-y-8">
      {groups.slice(0, split).map((group) => renderGroup(group, now))}
      {ordered}
      {groups.slice(split).map((group) => renderGroup(group, now))}
    </div>
  );
}

function renderGroup(group: ShipmentGroup<ShipmentListItem>, now: Date) {
  return (
    <section key={group.status} aria-labelledby={`group-${group.status}`}>
      <h2
        id={`group-${group.status}`}
        className="mb-2 text-sm font-semibold uppercase tracking-wide text-slate-500"
      >
        {group.label}{" "}
        <span className="font-normal text-slate-400">
          ({group.shipments.length})
        </span>
      </h2>
      <ul className="divide-y divide-slate-200 rounded-lg border border-slate-200 bg-white">
        {group.shipments.map((shipment) => (
          <li key={shipment.id}>
            <Link
              href={`/?shipment=${shipment.id}`}
              className="flex flex-col gap-1 p-4 hover:bg-slate-50"
            >
              <div className="flex items-center justify-between gap-3">
                <span className="font-medium">
                  {shipment.nickname ?? shipment.trackingNumber}
                </span>
                <StatusChip status={shipment.status} />
              </div>
              {shipment.nickname && (
                <span className="text-xs text-slate-500">
                  {shipment.trackingNumber}
                </span>
              )}
              <span className="text-sm text-slate-600">
                {formatEta(shipment.eta, now)}
              </span>
              {shipment.lastCheckpoint && (
                <span className="text-sm text-slate-500">
                  {[
                    shipment.lastCheckpoint.message,
                    shipment.lastCheckpoint.locationText,
                  ]
                    .filter(Boolean)
                    .join(" · ")}{" "}
                  ({formatRelativeTime(shipment.lastCheckpoint.occurredAt, now)}
                  )
                </span>
              )}
            </Link>
          </li>
        ))}
      </ul>
    </section>
  );
}

interface OrderedSectionProps {
  orders: OrderedItem[];
  now: Date;
  dismissAction?: (formData: FormData) => Promise<void>;
}

/**
 * Orders seen in a forwarded email that have no tracking number yet. Every
 * string here came from an email, so it is rendered as plain text only.
 */
function OrderedSection({ orders, now, dismissAction }: OrderedSectionProps) {
  return (
    <section aria-labelledby="group-Ordered">
      <h2
        id="group-Ordered"
        className="mb-2 text-sm font-semibold uppercase tracking-wide text-slate-500"
      >
        Ordered{" "}
        <span className="font-normal text-slate-400">({orders.length})</span>
      </h2>
      <ul className="divide-y divide-slate-200 rounded-lg border border-slate-200 bg-white">
        {orders.map((order) => {
          const details = [
            order.item ? order.retailer : null,
            order.orderNumber ? `#${order.orderNumber}` : null,
          ]
            .filter(Boolean)
            .join(" · ");
          return (
            <li
              key={order.id}
              className="flex items-start justify-between gap-3 p-4"
            >
              <div className="flex min-w-0 flex-col gap-1">
                <span className="font-medium">
                  {order.item ?? order.retailer ?? "Order"}
                </span>
                {details && (
                  <span className="text-sm text-slate-600">{details}</span>
                )}
                <span className="text-xs text-slate-500">
                  Waiting for a shipping email · ordered{" "}
                  {formatRelativeTime(order.createdAt, now)}
                </span>
              </div>
              {dismissAction && (
                <form action={dismissAction}>
                  <input type="hidden" name="orderId" value={order.id} />
                  <button
                    type="submit"
                    className="rounded-md px-3 py-1.5 text-sm hover:bg-slate-100"
                  >
                    Dismiss
                  </button>
                </form>
              )}
            </li>
          );
        })}
      </ul>
    </section>
  );
}
