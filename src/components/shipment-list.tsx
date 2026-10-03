import Link from "next/link";
import type { ShipmentListItem } from "@/lib/db/shipments";
import { formatEta, formatRelativeTime } from "@/lib/shipments/format";
import type { ShipmentGroup } from "@/lib/shipments/grouping";
import { StatusChip } from "./status-chip";

interface ShipmentListProps {
  groups: ShipmentGroup<ShipmentListItem>[];
  now: Date;
}

export function ShipmentList({ groups, now }: ShipmentListProps) {
  if (groups.length === 0) {
    return (
      <p className="rounded-lg border border-dashed border-slate-300 p-8 text-center text-slate-500">
        No packages yet — add a tracking number above.
      </p>
    );
  }

  return (
    <div className="space-y-8">
      {groups.map((group) => (
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
                      (
                      {formatRelativeTime(
                        shipment.lastCheckpoint.occurredAt,
                        now,
                      )}
                      )
                    </span>
                  )}
                </Link>
              </li>
            ))}
          </ul>
        </section>
      ))}
    </div>
  );
}
