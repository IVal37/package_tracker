"use client";

import "maplibre-gl/dist/maplibre-gl.css";
import type { GeoJSONSource, Map as MapLibreMap } from "maplibre-gl";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useMemo, useRef, useState } from "react";
import {
  DEFAULT_CENTER,
  DEFAULT_ZOOM,
  MAP_STYLE_URL,
} from "@/lib/geo/map-style";
import type { MapData, MapListItem } from "@/lib/geo/map-data";
// status.ts, not the @/lib/tracking index: the index pulls provider code and
// node:crypto into the client bundle.
import { MODES, type Mode } from "@/lib/tracking/status";
import { ModeIcon, modeIconSvg } from "./mode-icons";
import { StatusChip } from "./status-chip";

const ICON_PIXELS = 64;
const imageName = (mode: Mode) => `mode-${mode}`;

const drawerHref = (id: string) => `/?view=map&shipment=${id}`;

async function loadModeImage(mode: Mode): Promise<HTMLImageElement> {
  const image = new Image(ICON_PIXELS, ICON_PIXELS);
  image.src = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(
    modeIconSvg(mode, ICON_PIXELS),
  )}`;
  await image.decode();
  return image;
}

/** Draws everything on a fresh map: icons, routes, clustered points, clicks. */
async function populate(
  map: MapLibreMap,
  data: MapData,
  open: (id: string) => void,
) {
  for (const mode of MODES) {
    map.addImage(imageName(mode), await loadModeImage(mode), {
      pixelRatio: 2,
    });
  }

  map.addSource("routes", { type: "geojson", data: data.routes as never });
  map.addLayer({
    id: "routes-line",
    type: "line",
    source: "routes",
    paint: { "line-color": "#475569", "line-width": 2, "line-opacity": 0.7 },
  });

  map.addSource("shipments", {
    type: "geojson",
    data: data.points as never,
    cluster: true,
    clusterRadius: 40,
    clusterMaxZoom: 12,
  });
  map.addLayer({
    id: "clusters",
    type: "circle",
    source: "shipments",
    filter: ["has", "point_count"],
    paint: {
      "circle-color": "#0f172a",
      "circle-radius": ["step", ["get", "point_count"], 16, 5, 20, 20, 26],
      "circle-stroke-color": "#ffffff",
      "circle-stroke-width": 2,
    },
  });
  map.addLayer({
    id: "cluster-count",
    type: "symbol",
    source: "shipments",
    filter: ["has", "point_count"],
    layout: {
      "text-field": ["get", "point_count_abbreviated"],
      "text-size": 13,
      "text-font": ["Noto Sans Bold"],
    },
    paint: { "text-color": "#ffffff" },
  });
  map.addLayer({
    id: "shipment-icons",
    type: "symbol",
    source: "shipments",
    filter: ["!", ["has", "point_count"]],
    layout: {
      "icon-image": ["concat", "mode-", ["get", "mode"]],
      "icon-allow-overlap": true,
    },
  });

  map.on("click", "shipment-icons", (event) => {
    const id = event.features?.[0]?.properties?.id;
    if (typeof id === "string") open(id);
  });
  map.on("click", "clusters", async (event) => {
    const feature = event.features?.[0];
    const clusterId = feature?.properties?.cluster_id;
    if (feature?.geometry.type !== "Point" || typeof clusterId !== "number") {
      return;
    }
    const source = map.getSource("shipments") as GeoJSONSource;
    const zoom = await source.getClusterExpansionZoom(clusterId);
    const [lng, lat] = feature.geometry.coordinates;
    if (lng !== undefined && lat !== undefined) {
      map.easeTo({ center: [lng, lat], zoom });
    }
  });
  for (const layer of ["shipment-icons", "clusters"]) {
    map.on("mouseenter", layer, () => {
      map.getCanvas().style.cursor = "pointer";
    });
    map.on("mouseleave", layer, () => {
      map.getCanvas().style.cursor = "";
    });
  }
}

/** Fits the view to every point; a single point just gets a sensible zoom. */
async function fitToPoints(map: MapLibreMap, data: MapData) {
  const coordinates = data.points.features.map((f) => f.geometry.coordinates);
  const [first, ...rest] = coordinates;
  if (!first) return;
  if (rest.length === 0) {
    map.jumpTo({ center: first, zoom: 6 });
    return;
  }
  const { LngLatBounds } = await import("maplibre-gl");
  const bounds = new LngLatBounds(first, first);
  for (const point of rest) bounds.extend(point);
  map.fitBounds(bounds, { padding: 60, maxZoom: 8, duration: 0 });
}

function PackageList({
  title,
  items,
  empty,
}: {
  title: string;
  items: MapListItem[];
  empty?: string;
}) {
  if (items.length === 0 && !empty) return null;
  return (
    <section aria-label={title}>
      <h2 className="mb-2 text-sm font-semibold uppercase tracking-wide text-slate-500">
        {title}{" "}
        <span className="font-normal text-slate-400">({items.length})</span>
      </h2>
      {items.length === 0 ? (
        <p className="text-sm text-slate-500">{empty}</p>
      ) : (
        <ul className="divide-y divide-slate-200 rounded-lg border border-slate-200 bg-white">
          {items.map((item) => (
            <li key={item.id}>
              <Link
                href={drawerHref(item.id)}
                className="flex items-center justify-between gap-3 p-3 hover:bg-slate-50"
              >
                <span className="flex items-center gap-2 font-medium">
                  <ModeIcon mode={item.mode} className="text-slate-500" />
                  {item.name}
                </span>
                <StatusChip status={item.status} />
              </Link>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

interface ShipmentMapProps {
  data: MapData;
}

/**
 * The map view: a MapLibre map plus plain lists of the same packages, so the
 * map is never the only way to reach one. MapLibre needs WebGL, so it is
 * loaded in the browser only.
 */
export function ShipmentMap({ data }: ShipmentMapProps) {
  const router = useRouter();
  // Click handlers outlive renders, so they read the latest router from a ref;
  // the map itself must not be rebuilt just because the router object changed.
  const routerRef = useRef(router);
  useEffect(() => {
    routerRef.current = router;
  }, [router]);
  const container = useRef<HTMLDivElement>(null);
  const [failed, setFailed] = useState(false);
  // Re-create the map only when the map data actually changes, not on every
  // server re-render (opening the drawer re-renders with identical data).
  const dataKey = useMemo(() => JSON.stringify(data), [data]);

  useEffect(() => {
    const mapData = JSON.parse(dataKey) as MapData;
    let cancelled = false;
    let map: MapLibreMap | undefined;

    (async () => {
      try {
        const maplibre = await import("maplibre-gl");
        if (cancelled || !container.current) return;

        map = new maplibre.Map({
          container: container.current,
          style: MAP_STYLE_URL,
          center: DEFAULT_CENTER,
          zoom: DEFAULT_ZOOM,
        });
        const created = map;
        created.on("load", async () => {
          try {
            await populate(created, mapData, (id) =>
              routerRef.current.push(drawerHref(id)),
            );
            await fitToPoints(created, mapData);
          } catch {
            if (!cancelled) setFailed(true);
          }
        });
      } catch {
        // No WebGL, or the library failed to load: the lists below still work.
        if (!cancelled) setFailed(true);
      }
    })();

    return () => {
      cancelled = true;
      map?.remove();
    };
  }, [dataKey]);

  return (
    <div className="space-y-8">
      {failed ? (
        <p
          role="status"
          className="rounded-lg border border-amber-300 bg-amber-50 p-4 text-sm text-amber-900"
        >
          The map couldn&apos;t load. Your packages are listed below.
        </p>
      ) : (
        <div
          ref={container}
          role="region"
          aria-label="Map of your packages"
          data-testid="shipment-map"
          className="h-[28rem] w-full overflow-hidden rounded-lg border border-slate-200"
        />
      )}
      <PackageList
        title="On the map"
        items={data.placed}
        empty={
          data.unplaced.length === 0
            ? "No packages yet — add a tracking number above."
            : "None of your packages has a known location yet."
        }
      />
      <PackageList title="Not on the map yet" items={data.unplaced} />
    </div>
  );
}
