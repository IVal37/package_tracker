import Link from "next/link";
import type { ShipmentListItem } from "@/lib/db/shipments";
import type { OrderStage } from "@/lib/email/order-stage";
import { formatRelativeTime, formatShipmentEta } from "@/lib/shipments/format";
import type { ShipmentGroup } from "@/lib/shipments/grouping";
import { StatusChip } from "./status-chip";

/** What the list needs to show an order that has no shipment yet. */
export interface OrderedItem {
  id: string;
  retailer: string | null;
  item: string | null;
  orderNumber: string | null;
  /** What the emails say; without a package this is all there is. */
  stage: OrderStage;
  /** The retailer's own estimate, as worded in the email. */
  etaText: string | null;
  /** When the email that set the stage arrived. */
  stageAt: Date | null;
  createdAt: Date;
}

interface ShipmentListProps {
  groups: ShipmentGroup<ShipmentListItem>[];
  now: Date;
  /** Orders with no package: waiting for a shipping email, or known only from emails. */
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
      <p className="rounded-card border border-dashed border-slate-300 p-8 text-center text-slate-500">
        No packages yet — add a tracking number above.
      </p>
    );
  }

  const split = orderedIndex(groups);
  const section = (stage: OrderStage) => {
    const matching = orders.filter((order) => order.stage === stage);
    return (
      matching.length > 0 && (
        <OrderSection
          key={stage}
          stage={stage}
          orders={matching}
          now={now}
          dismissAction={dismissOrderAction}
        />
      )
    );
  };

  return (
    <div className="space-y-8">
      {groups.slice(0, split).map((group) => renderGroup(group, now))}
      {section("shipped")}
      {section("ordered")}
      {groups.slice(split).map((group) => renderGroup(group, now))}
      {section("delivered")}
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
      <ul className="divide-y divide-slate-200/60 overflow-hidden rounded-card glass-card">
        {group.shipments.map((shipment) => (
          <li key={shipment.id}>
            <Link
              href={`/?shipment=${shipment.id}`}
              className="flex flex-col gap-1 p-4 hover-glass"
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
                {formatShipmentEta(shipment, now)}
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

const ORDER_SECTION_TITLES: Record<OrderStage, string> = {
  shipped: "Shipped, no tracking number",
  ordered: "Ordered",
  delivered: "Delivered, no tracking number",
};

interface OrderSectionProps {
  stage: OrderStage;
  orders: OrderedItem[];
  now: Date;
  dismissAction?: (formData: FormData) => Promise<void>;
}

/** The two lines under an order's name: what is known, and where it came from. */
function orderLines(order: OrderedItem, now: Date) {
  if (order.stage === "ordered") {
    return {
      status: null,
      source: `Waiting for a shipping email · ordered ${formatRelativeTime(order.createdAt, now)}`,
    };
  }
  const heard = order.stageAt
    ? `From an email ${formatRelativeTime(order.stageAt, now)}`
    : "From an email";
  return order.stage === "shipped"
    ? {
        status: order.etaText ? `Shipped · ${order.etaText}` : "Shipped",
        source: `${heard} · no tracking number yet`,
      }
    : { status: "Delivered", source: heard };
}

/**
 * Orders seen in forwarded emails that have no package: waiting for a shipping
 * email, or shipped or delivered according to an email that had no tracking
 * number. Every string here came from an email, so it is rendered as plain
 * text only.
 */
function OrderSection({
  stage,
  orders,
  now,
  dismissAction,
}: OrderSectionProps) {
  const headingId = `orders-${stage}`;
  return (
    <section aria-labelledby={headingId}>
      <h2
        id={headingId}
        className="mb-2 text-sm font-semibold uppercase tracking-wide text-slate-500"
      >
        {ORDER_SECTION_TITLES[stage]}{" "}
        <span className="font-normal text-slate-400">({orders.length})</span>
      </h2>
      <ul className="divide-y divide-slate-200/60 overflow-hidden rounded-card glass-card">
        {orders.map((order) => {
          const details = [
            order.item ? order.retailer : null,
            order.orderNumber ? `#${order.orderNumber}` : null,
          ]
            .filter(Boolean)
            .join(" · ");
          const { status, source } = orderLines(order, now);
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
                {status && (
                  <span className="text-sm text-slate-700">{status}</span>
                )}
                <span className="text-xs text-slate-500">{source}</span>
              </div>
              {dismissAction && (
                <form action={dismissAction}>
                  <input type="hidden" name="orderId" value={order.id} />
                  <button
                    type="submit"
                    className="hover-glass rounded-full px-3 py-1.5 text-sm"
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
