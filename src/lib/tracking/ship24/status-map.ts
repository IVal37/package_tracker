import type { Status } from "../status";

export const SHIP24_MILESTONES = [
  "pending",
  "info_received",
  "in_transit",
  "out_for_delivery",
  "failed_attempt",
  "available_for_pickup",
  "delivered",
  "exception",
] as const;

export type Ship24Milestone = (typeof SHIP24_MILESTONES)[number];

export const SHIP24_MILESTONE_TO_STATUS: Record<Ship24Milestone, Status> = {
  pending: "Pending",
  info_received: "InfoReceived",
  in_transit: "InTransit",
  out_for_delivery: "OutForDelivery",
  failed_attempt: "AttemptFail",
  available_for_pickup: "AvailableForPickup",
  delivered: "Delivered",
  exception: "Exception",
};

function isMilestone(value: string): value is Ship24Milestone {
  return Object.hasOwn(SHIP24_MILESTONE_TO_STATUS, value);
}

/**
 * Maps Ship24's milestone (and optional finer statusCode) to our Status.
 * An unknown milestone falls back to Pending so a new Ship24 value can't break
 * ingestion. Ship24 has no "expired" state; Expired is assigned by Wayfind.
 */
export function mapShip24Status(
  milestone: string,
  statusCode?: string | null,
): Status {
  if (
    statusCode &&
    (statusCode.startsWith("exception_") ||
      statusCode === "data_order_cancelled")
  ) {
    return "Exception";
  }
  return isMilestone(milestone)
    ? SHIP24_MILESTONE_TO_STATUS[milestone]
    : "Pending";
}
