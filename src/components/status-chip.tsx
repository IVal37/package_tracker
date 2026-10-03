import { STATUS_LABELS } from "@/lib/shipments/grouping";
import type { Status } from "@/lib/tracking";

const STYLES: Record<Status, string> = {
  Pending: "bg-slate-100 text-slate-700",
  InfoReceived: "bg-slate-100 text-slate-700",
  InTransit: "bg-blue-100 text-blue-800",
  OutForDelivery: "bg-indigo-100 text-indigo-800",
  AttemptFail: "bg-amber-100 text-amber-800",
  Delivered: "bg-green-100 text-green-800",
  AvailableForPickup: "bg-teal-100 text-teal-800",
  Exception: "bg-red-100 text-red-800",
  Expired: "bg-slate-200 text-slate-600",
};

export function StatusChip({ status }: { status: Status }) {
  return (
    <span
      data-status={status}
      className={`inline-block rounded-full px-2 py-0.5 text-xs font-medium ${STYLES[status]}`}
    >
      {STATUS_LABELS[status]}
    </span>
  );
}
