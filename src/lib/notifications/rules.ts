// When a shipment changes, which alerts (if any) does that change deserve?
// Pure, so the rules are tested without a database. The dedupe key is what
// makes "once per event" true: the same event always yields the same key, and
// the database refuses a second row with it.
import type { Status } from "@/lib/tracking/status";

export const NOTIFICATION_KINDS = [
  "out_for_delivery",
  "delivered",
  "problem",
  "delay",
] as const;

export type NotificationKind = (typeof NOTIFICATION_KINDS)[number];

/** The part of a shipment the rules look at. */
export interface ShipmentSnapshot {
  status: Status;
  eta: Date | null;
  lastEventAt: Date | null;
}

export interface AlertCandidate {
  kind: NotificationKind;
  dedupeKey: string;
}

/** An ETA this long past with no delivery counts as late. */
export const OVERDUE_AFTER_MS = 24 * 60 * 60 * 1000;
/**
 * ...but only for a while. A parcel whose ETA is weeks old is stuck or
 * forgotten, not "running late"; the Expired job (Phase 7) deals with those.
 * It also keeps the first scan after a deploy from alerting on old data.
 */
export const OVERDUE_MAX_AGE_MS = 14 * 24 * 60 * 60 * 1000;

/** The alert a shipment entering this status deserves, if any. */
export function kindForStatus(status: Status): NotificationKind | null {
  switch (status) {
    case "OutForDelivery":
      return "out_for_delivery";
    case "Delivered":
    case "AvailableForPickup":
      return "delivered";
    case "Exception":
    case "AttemptFail":
      return "problem";
    default:
      return null;
  }
}

/** The UTC calendar day of a moment, as YYYY-MM-DD. */
export function utcDay(date: Date): string {
  return date.toISOString().slice(0, 10);
}

/** Statuses after which a later ETA or an overdue ETA means nothing. */
const FINISHED: readonly Status[] = ["Delivered", "Expired"];

/**
 * The alerts a stored shipment's change to a new state earns. Fires only when
 * the status or the ETA really changed, so a repeated webhook, a re-fetch that
 * learns nothing new and a late older event (which leaves the state as it was)
 * all yield nothing.
 *
 *  - A new status that maps to a kind: keyed by the status and the newest event
 *    time, so out for delivery on Monday and again on Tuesday are two alerts.
 *  - The ETA moving to a later UTC calendar day before delivery: keyed by the
 *    new day, so each new promise alerts once.
 */
export function alertsForUpdate(
  before: ShipmentSnapshot,
  after: ShipmentSnapshot,
): AlertCandidate[] {
  const alerts: AlertCandidate[] = [];

  if (after.status !== before.status) {
    const kind = kindForStatus(after.status);
    if (kind) {
      const when = after.lastEventAt?.toISOString() ?? "no-event";
      alerts.push({ kind, dedupeKey: `${after.status}:${when}` });
    }
  }

  if (
    before.eta &&
    after.eta &&
    !FINISHED.includes(after.status) &&
    utcDay(after.eta) > utcDay(before.eta)
  ) {
    alerts.push({ kind: "delay", dedupeKey: `eta:${utcDay(after.eta)}` });
  }

  return alerts;
}

/**
 * True when the ETA passed more than a day ago and the parcel is neither
 * finished nor waiting at a pickup point. Many carriers never update the ETA, so
 * this catches the delay they do not report.
 */
export function isOverdue(
  shipment: { status: Status; eta: Date | null; archived?: boolean },
  now: Date,
): boolean {
  if (!shipment.eta || shipment.archived) return false;
  if (FINISHED.includes(shipment.status)) return false;
  if (shipment.status === "AvailableForPickup") return false;
  const age = now.getTime() - shipment.eta.getTime();
  return age > OVERDUE_AFTER_MS && age <= OVERDUE_MAX_AGE_MS;
}

/** The dedupe key for an overdue alert: one per promised day. */
export function overdueDedupeKey(eta: Date): string {
  return `overdue:${utcDay(eta)}`;
}

/** ETAs in (from, to] are overdue at `now`: the scan's window. */
export function overdueWindow(now: Date): { from: Date; to: Date } {
  return {
    from: new Date(now.getTime() - OVERDUE_MAX_AGE_MS),
    to: new Date(now.getTime() - OVERDUE_AFTER_MS),
  };
}
