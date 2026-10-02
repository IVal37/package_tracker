// Internal shipment status and transport-mode values. Kept free of any
// provider import so the DB schema can use them.

export const STATUSES = [
  "Pending",
  "InfoReceived",
  "InTransit",
  "OutForDelivery",
  "AttemptFail",
  "Delivered",
  "AvailableForPickup",
  "Exception",
  "Expired",
] as const;

export type Status = (typeof STATUSES)[number];

export const MODES = ["truck", "plane", "ship", "van", "pin"] as const;

export type Mode = (typeof MODES)[number];
