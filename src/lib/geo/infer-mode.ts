import type { Mode, Status } from "@/lib/tracking";
import { haversineKm, type LatLng } from "./distance";

export interface ModeCheckpoint {
  status: Status;
  message: string | null;
  locationText: string | null;
  occurredAt: Date;
  /** Null when the place has not been geocoded, or could not be. */
  point: LatLng | null;
}

/** Two located hops further apart than this, within a day, mean a flight. */
export const AIR_HOP_KM = 800;
const AIR_HOP_WINDOW_MS = 24 * 60 * 60 * 1000;

const AIR =
  /\b(?:airport|airline|airlines|aircraft|airfreight|flight|by\s+air|air\s+(?:gateway|hub|freight|cargo|terminal|transport))\b/;

// Phrases, not bare words: "Port Washington, NY", "Oceanside, CA" and "Harbor
// Beach, MI" are towns. "Port of X" counts, but "port of entry" does not (it is
// as often a land border or an airport).
const SEA =
  /\b(?:vessel|maritime|seaport|ocean\s+(?:freight|carrier|vessel)|container\s+ship|sea\s+freight|seafreight|by\s+sea|port\s+terminal)\b|\bport\s+of\s+(?!entry\b)/;

// Out for delivery / failed attempt: a local vehicle is moving.
const VAN: readonly Status[] = ["OutForDelivery", "AttemptFail"];

/**
 * Best guess at how a parcel is moving at this checkpoint, from its status,
 * its wording and how far it jumped from the previous located checkpoint. It is
 * a heuristic, shown to the user as a "best guess".
 */
export function inferMode(
  current: ModeCheckpoint,
  previous: ModeCheckpoint | null,
): Mode {
  if (VAN.includes(current.status)) return "van";
  if (current.status !== "InTransit") return "pin";

  const text = `${current.message ?? ""} ${current.locationText ?? ""}`
    .toLowerCase()
    .replace(/\s+/g, " ");
  if (AIR.test(text)) return "plane";
  if (SEA.test(text)) return "ship";

  if (current.point && previous?.point) {
    const elapsed =
      current.occurredAt.getTime() - previous.occurredAt.getTime();
    const farEnough = haversineKm(previous.point, current.point) > AIR_HOP_KM;
    if (farEnough && elapsed >= 0 && elapsed <= AIR_HOP_WINDOW_MS) {
      return "plane";
    }
  }
  return "truck";
}

/**
 * The mode of a whole shipment: that of its newest checkpoint, with the hop
 * measured from the nearest earlier checkpoint that has coordinates.
 * `oldestFirst` must be in time order; no checkpoints means nothing is moving.
 */
export function shipmentMode(oldestFirst: readonly ModeCheckpoint[]): Mode {
  const current = oldestFirst.at(-1);
  if (!current) return "pin";
  const previous =
    oldestFirst
      .slice(0, -1)
      .reverse()
      .find((checkpoint) => checkpoint.point !== null) ?? null;
  return inferMode(current, previous);
}
