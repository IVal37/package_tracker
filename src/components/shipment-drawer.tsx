"use client";

import { useRouter } from "next/navigation";
import { useCallback, useState } from "react";
import type { CheckpointRow, ShipmentRow } from "@/lib/db/shipments";
import { formatEta } from "@/lib/shipments/format";
import type { Mode } from "@/lib/tracking";
import { ModeIcon, MODE_LABELS } from "./mode-icons";
import { Modal } from "./modal";
import { StatusChip } from "./status-chip";
import { Timeline } from "./timeline";

interface ShipmentDrawerProps {
  shipment: ShipmentRow;
  /** Newest first. */
  checkpoints: CheckpointRow[];
  now: Date;
  deleteAction: (formData: FormData) => Promise<void>;
  /** Where closing goes: the list, or the map, whichever it was opened from. */
  closeHref?: string;
  /** Best guess at how it is moving; omitted when unknown. */
  mode?: Mode;
  /** The order this package came from, when it was captured from an email. */
  order?: { retailer: string | null; orderNumber: string | null } | null;
}

/** "Ordered from Target · #1001", or null when the email gave neither part. */
function describeOrder(order: NonNullable<ShipmentDrawerProps["order"]>) {
  const from = order.retailer ? `Ordered from ${order.retailer}` : "Ordered";
  const number = order.orderNumber ? `#${order.orderNumber}` : null;
  if (!order.retailer && !number) return null;
  return [from, number].filter(Boolean).join(" · ");
}

/** Detail drawer for one shipment. Closing it navigates back to the view it came from. */
export function ShipmentDrawer({
  shipment,
  checkpoints,
  now,
  deleteAction,
  closeHref = "/",
  mode,
  order,
}: ShipmentDrawerProps) {
  const router = useRouter();
  const [confirming, setConfirming] = useState(false);
  const close = useCallback(() => router.push(closeHref), [router, closeHref]);
  const orderLine = order ? describeOrder(order) : null;

  return (
    <Modal
      title={shipment.nickname ?? shipment.trackingNumber}
      onClose={close}
      variant="drawer"
    >
      <dl className="mb-6 grid grid-cols-[auto_1fr] gap-x-4 gap-y-2 text-sm">
        <dt className="text-slate-500">Tracking number</dt>
        <dd>{shipment.trackingNumber}</dd>
        {orderLine && (
          <>
            <dt className="text-slate-500">Order</dt>
            <dd>{orderLine}</dd>
          </>
        )}
        <dt className="text-slate-500">Courier</dt>
        <dd>{shipment.courier ?? "Unknown"}</dd>
        <dt className="text-slate-500">Status</dt>
        <dd>
          <StatusChip status={shipment.status} />
        </dd>
        <dt className="text-slate-500">Estimated delivery</dt>
        <dd>{formatEta(shipment.eta, now)}</dd>
        {mode && (
          <>
            <dt className="text-slate-500">Moving by</dt>
            <dd className="flex items-center gap-2">
              <ModeIcon mode={mode} className="text-slate-600" />
              <span>{MODE_LABELS[mode]}</span>
              <span className="text-xs text-slate-500">(best guess)</span>
            </dd>
          </>
        )}
      </dl>

      <h3 className="mb-3 text-sm font-semibold uppercase tracking-wide text-slate-500">
        Timeline
      </h3>
      <Timeline checkpoints={checkpoints} />

      <form
        action={deleteAction}
        className="mt-8 border-t border-slate-200 pt-4"
      >
        <input type="hidden" name="shipmentId" value={shipment.id} />
        {confirming ? (
          <div className="flex items-center gap-3">
            <span className="text-sm">Delete this package?</span>
            <button
              type="submit"
              className="rounded-md bg-red-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-red-700"
            >
              Yes, delete
            </button>
            <button
              type="button"
              onClick={() => setConfirming(false)}
              className="rounded-md px-3 py-1.5 text-sm hover:bg-slate-100"
            >
              Cancel
            </button>
          </div>
        ) : (
          <button
            type="button"
            onClick={() => setConfirming(true)}
            className="rounded-md border border-red-300 px-3 py-1.5 text-sm font-medium text-red-700 hover:bg-red-50"
          >
            Delete
          </button>
        )}
      </form>
    </Modal>
  );
}
