import type { MapShipment } from "@/lib/db/shipments";
import type { Mode, Status } from "@/lib/tracking";
import type { LatLng } from "./distance";
import { shipmentMode } from "./infer-mode";

export interface PointProperties {
  id: string;
  name: string;
  status: Status;
  mode: Mode;
  /** True when this is the destination pin, not a place the parcel has been. */
  fallback: boolean;
}

export interface PointFeature {
  type: "Feature";
  properties: PointProperties;
  /** GeoJSON order: [lng, lat]. */
  geometry: { type: "Point"; coordinates: [number, number] };
}

export interface RouteFeature {
  type: "Feature";
  properties: { id: string };
  geometry: { type: "LineString"; coordinates: [number, number][] };
}

export interface MapListItem {
  id: string;
  name: string;
  status: Status;
  mode: Mode;
}

export interface MapData {
  points: { type: "FeatureCollection"; features: PointFeature[] };
  routes: { type: "FeatureCollection"; features: RouteFeature[] };
  /** Shipments shown on the map, for the list below it. */
  placed: MapListItem[];
  /** Shipments with no known location at all. */
  unplaced: MapListItem[];
}

const sameSpot = (a: LatLng, b: LatLng) => a.lat === b.lat && a.lng === b.lng;

/**
 * GeoJSON coordinates ([lng, lat]) for a route, with each longitude shifted by
 * a multiple of 360 so it is within 180 degrees of the previous one. Without
 * this, Shenzhen -> Los Angeles (113.8 -> -118.4) is drawn the long way across
 * Asia, Europe and the Atlantic instead of across the Pacific. MapLibre draws
 * longitudes beyond +/-180 correctly, as another copy of the world.
 */
function unwrapLongitudes(path: readonly LatLng[]): [number, number][] {
  const coordinates: [number, number][] = [];
  let previous: number | undefined;
  for (const { lat, lng } of path) {
    let unwrapped = lng;
    if (previous !== undefined) {
      while (unwrapped - previous > 180) unwrapped -= 360;
      while (unwrapped - previous < -180) unwrapped += 360;
    }
    coordinates.push([unwrapped, lat]);
    previous = unwrapped;
  }
  return coordinates;
}

/**
 * Turns shipments into what the map draws.
 * - A shipment with a located checkpoint gets an icon at the newest one, and a
 *   route through every located checkpoint in time order (consecutive repeats
 *   collapsed; a line needs at least two distinct points).
 * - With none, but a located destination, it gets a destination pin.
 * - With neither, it is listed as unplaced rather than dropped.
 */
export function buildMapData(shipments: readonly MapShipment[]): MapData {
  const points: PointFeature[] = [];
  const routes: RouteFeature[] = [];
  const placed: MapListItem[] = [];
  const unplaced: MapListItem[] = [];

  for (const shipment of shipments) {
    const located = shipment.checkpoints.filter(
      (checkpoint): checkpoint is typeof checkpoint & { point: LatLng } =>
        checkpoint.point !== null,
    );
    const mode = shipmentMode(shipment.checkpoints);
    const base = {
      id: shipment.id,
      name: shipment.name,
      status: shipment.status,
    };

    const newest = located.at(-1);
    if (newest) {
      placed.push({ ...base, mode });
      points.push(pointFeature(base, mode, newest.point, false));

      const path: LatLng[] = [];
      for (const checkpoint of located) {
        const last = path.at(-1);
        if (!last || !sameSpot(last, checkpoint.point))
          path.push(checkpoint.point);
      }
      if (path.length >= 2) {
        routes.push({
          type: "Feature",
          properties: { id: shipment.id },
          geometry: {
            type: "LineString",
            coordinates: unwrapLongitudes(path),
          },
        });
      }
    } else if (shipment.destination) {
      placed.push({ ...base, mode: "pin" });
      points.push(pointFeature(base, "pin", shipment.destination, true));
    } else {
      unplaced.push({ ...base, mode });
    }
  }

  return {
    points: { type: "FeatureCollection", features: points },
    routes: { type: "FeatureCollection", features: routes },
    placed,
    unplaced,
  };
}

function pointFeature(
  base: { id: string; name: string; status: Status },
  mode: Mode,
  point: LatLng,
  fallback: boolean,
): PointFeature {
  return {
    type: "Feature",
    properties: { ...base, mode, fallback },
    geometry: { type: "Point", coordinates: [point.lng, point.lat] },
  };
}
