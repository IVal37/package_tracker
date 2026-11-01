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

/** Finished shipments: never re-fetched, and a later ETA means nothing. */
export const FINISHED_STATUSES: readonly Status[] = ["Delivered", "Expired"];

/** Statuses where the ETA is history rather than a promise, so it cannot be overdue. */
export const ETA_SETTLED_STATUSES: readonly Status[] = [
  ...FINISHED_STATUSES,
  "AvailableForPickup",
];

export const MODES = ["truck", "plane", "ship", "van", "pin"] as const;

export type Mode = (typeof MODES)[number];
