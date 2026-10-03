import type { CheckpointRow } from "@/lib/db/shipments";
import { StatusChip } from "./status-chip";

// Fixed to UTC so server and client render identical text (no hydration mismatch).
const formatter = new Intl.DateTimeFormat("en-US", {
  timeZone: "UTC",
  dateStyle: "medium",
  timeStyle: "short",
});

type TimelineItem = Pick<
  CheckpointRow,
  "id" | "status" | "message" | "locationText" | "occurredAt"
>;

/** Checkpoints, newest first (the caller supplies them in that order). */
export function Timeline({ checkpoints }: { checkpoints: TimelineItem[] }) {
  if (checkpoints.length === 0) {
    return <p className="text-sm text-slate-500">No tracking events yet.</p>;
  }

  return (
    <ol className="space-y-4 border-l border-slate-200 pl-4">
      {checkpoints.map((checkpoint) => (
        <li key={checkpoint.id}>
          <div className="flex items-center gap-2">
            <StatusChip status={checkpoint.status} />
            <time
              dateTime={checkpoint.occurredAt.toISOString()}
              className="text-xs text-slate-500"
            >
              {formatter.format(checkpoint.occurredAt)} UTC
            </time>
          </div>
          <p className="mt-1 text-sm">{checkpoint.message ?? "Update"}</p>
          {checkpoint.locationText && (
            <p className="text-xs text-slate-500">{checkpoint.locationText}</p>
          )}
        </li>
      ))}
    </ol>
  );
}
