import { render, screen, waitFor, within } from "@testing-library/react";
import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { MAP_STYLE_URL } from "@/lib/geo/map-style";
import type { MapData, PointFeature } from "@/lib/geo/map-data";
import { MODES } from "@/lib/tracking/status";

// MapLibre needs WebGL, which jsdom doesn't have. The fake records everything
// the component asks of it so the tests can check the contract.
const h = vi.hoisted(() => {
  type Handler = (event?: unknown) => unknown;

  class FakeMap {
    static instances: FakeMap[] = [];
    static failOnCreate = false;

    options: Record<string, unknown>;
    images = new Map<string, unknown>();
    sources = new Map<string, Record<string, unknown>>();
    layers: Record<string, unknown>[] = [];
    handlers: { type: string; layer?: string; handler: Handler }[] = [];
    removed = false;
    easeTo = vi.fn();
    jumpTo = vi.fn();
    fitBounds = vi.fn();
    clusterZoom = vi.fn(async (_id: number) => 7);
    canvas = { style: { cursor: "" } };

    constructor(options: Record<string, unknown>) {
      if (FakeMap.failOnCreate) throw new Error("WebGL unavailable");
      this.options = options;
      FakeMap.instances.push(this);
    }

    on(type: string, a: string | Handler, b?: Handler) {
      if (typeof a === "function") this.handlers.push({ type, handler: a });
      else if (b) this.handlers.push({ type, layer: a, handler: b });
      return this;
    }
    addImage(name: string, image: unknown, options: unknown) {
      this.images.set(name, { image, options });
    }
    addSource(id: string, spec: Record<string, unknown>) {
      this.sources.set(id, spec);
    }
    addLayer(spec: Record<string, unknown>) {
      this.layers.push(spec);
    }
    getSource() {
      return { getClusterExpansionZoom: this.clusterZoom };
    }
    getCanvas() {
      return this.canvas;
    }
    remove() {
      this.removed = true;
    }

    /** Runs the handlers registered for an event; resolves when they finish. */
    async fire(type: string, layer?: string, event?: unknown) {
      await Promise.all(
        this.handlers
          .filter((entry) => entry.type === type && entry.layer === layer)
          .map((entry) => entry.handler(event)),
      );
    }
  }

  class LngLatBounds {
    points: [number, number][];
    constructor(a: [number, number], b: [number, number]) {
      this.points = [a, b];
    }
    extend(point: [number, number]) {
      this.points.push(point);
      return this;
    }
  }

  return { FakeMap, LngLatBounds, push: vi.fn() };
});

vi.mock("maplibre-gl", () => ({
  Map: h.FakeMap,
  LngLatBounds: h.LngLatBounds,
}));
vi.mock("next/navigation", () => ({ useRouter: () => ({ push: h.push }) }));

import { ShipmentMap } from "./shipment-map";

const point = (
  id: string,
  mode: PointFeature["properties"]["mode"],
  lng: number,
  lat: number,
): PointFeature => ({
  type: "Feature",
  properties: {
    id,
    name: `Package ${id}`,
    status: "InTransit",
    mode,
    fallback: false,
  },
  geometry: { type: "Point", coordinates: [lng, lat] },
});

const mapData = (overrides: Partial<MapData> = {}): MapData => ({
  points: {
    type: "FeatureCollection",
    features: [point("a", "truck", -90, 35), point("b", "plane", -122, 37)],
  },
  routes: {
    type: "FeatureCollection",
    features: [
      {
        type: "Feature",
        properties: { id: "a" },
        geometry: {
          type: "LineString",
          coordinates: [
            [-87, 41],
            [-90, 35],
          ],
        },
      },
    ],
  },
  placed: [
    { id: "a", name: "Package a", status: "InTransit", mode: "truck" },
    { id: "b", name: "Package b", status: "InTransit", mode: "plane" },
  ],
  unplaced: [
    { id: "c", name: "Package c", status: "InfoReceived", mode: "pin" },
  ],
  ...overrides,
});

beforeAll(() => {
  // jsdom doesn't implement image decoding.
  HTMLImageElement.prototype.decode = vi.fn(async () => {});
});

beforeEach(() => {
  h.FakeMap.instances = [];
  h.FakeMap.failOnCreate = false;
  h.push.mockClear();
});

/** Renders, waits for the map to be created, and fires its load event. */
async function renderLoaded(data: MapData = mapData()) {
  const view = render(<ShipmentMap data={data} />);
  await waitFor(() => expect(h.FakeMap.instances).toHaveLength(1));
  const map = h.FakeMap.instances[0]!;
  await map.fire("load");
  return { ...view, map };
}

describe("ShipmentMap: the map", () => {
  it("creates a MapLibre map in its container with the OpenFreeMap style", async () => {
    const { map } = await renderLoaded();
    expect(map.options.style).toBe(MAP_STYLE_URL);
    expect(MAP_STYLE_URL).toContain("tiles.openfreemap.org");
    expect(map.options.container).toBe(screen.getByTestId("shipment-map"));
    expect(
      screen.getByRole("region", { name: "Map of your packages" }),
    ).toBeInTheDocument();
  });

  it("registers an image for every one of the five transport modes", async () => {
    const { map } = await renderLoaded();
    expect([...map.images.keys()].sort()).toEqual(
      MODES.map((mode) => `mode-${mode}`).sort(),
    );
    for (const entry of map.images.values()) {
      expect((entry as { options: unknown }).options).toEqual({
        pixelRatio: 2,
      });
    }
  });

  it("picks each icon by the shipment's mode", async () => {
    const { map } = await renderLoaded();
    const icons = map.layers.find((layer) => layer.id === "shipment-icons");
    expect(icons).toMatchObject({
      type: "symbol",
      source: "shipments",
      layout: {
        "icon-image": ["concat", "mode-", ["get", "mode"]],
        "icon-allow-overlap": true,
      },
    });
    // Every mode a point can carry has a matching registered image.
    for (const feature of mapData().points.features) {
      expect(map.images.has(`mode-${feature.properties.mode}`)).toBe(true);
    }
  });

  it("feeds routes and clustered points to the map", async () => {
    const data = mapData();
    const { map } = await renderLoaded(data);

    expect(map.sources.get("routes")).toMatchObject({
      type: "geojson",
      data: data.routes,
    });
    expect(map.sources.get("shipments")).toMatchObject({
      type: "geojson",
      data: data.points,
      cluster: true,
    });
    expect(map.layers.map((layer) => layer.id)).toEqual([
      "routes-line",
      "clusters",
      "cluster-count",
      "shipment-icons",
    ]);
  });

  it("opens the drawer for a tapped icon, staying in map view", async () => {
    const { map } = await renderLoaded();
    await map.fire("click", "shipment-icons", {
      features: [{ properties: { id: "b" } }],
    });
    expect(h.push).toHaveBeenCalledExactlyOnceWith("/?view=map&shipment=b");
  });

  it("ignores a tap that carries no usable id", async () => {
    const { map } = await renderLoaded();
    await map.fire("click", "shipment-icons", { features: [] });
    await map.fire("click", "shipment-icons", {
      features: [{ properties: { id: 42 } }],
    });
    expect(h.push).not.toHaveBeenCalled();
  });

  it("zooms into a tapped cluster", async () => {
    const { map } = await renderLoaded();
    await map.fire("click", "clusters", {
      features: [
        {
          properties: { cluster_id: 9 },
          geometry: { type: "Point", coordinates: [-100, 40] },
        },
      ],
    });
    expect(map.clusterZoom).toHaveBeenCalledWith(9);
    expect(map.easeTo).toHaveBeenCalledWith({ center: [-100, 40], zoom: 7 });
    expect(h.push).not.toHaveBeenCalled();
  });

  it("ignores a cluster tap without cluster data", async () => {
    const { map } = await renderLoaded();
    await map.fire("click", "clusters", { features: [] });
    expect(map.easeTo).not.toHaveBeenCalled();
  });

  it("shows a pointer cursor over icons and clusters", async () => {
    const { map } = await renderLoaded();
    for (const layer of ["shipment-icons", "clusters"]) {
      await map.fire("mouseenter", layer);
      expect(map.canvas.style.cursor).toBe("pointer");
      await map.fire("mouseleave", layer);
      expect(map.canvas.style.cursor).toBe("");
    }
  });

  it("fits the view to several points", async () => {
    const { map } = await renderLoaded();
    expect(map.fitBounds).toHaveBeenCalledOnce();
    const [bounds, options] = map.fitBounds.mock.calls[0]!;
    expect(bounds.points).toEqual([
      [-90, 35],
      [-90, 35],
      [-122, 37],
    ]);
    expect(options).toMatchObject({ padding: 60, maxZoom: 8 });
    expect(map.jumpTo).not.toHaveBeenCalled();
  });

  it("centres on a single point instead of fitting bounds", async () => {
    const { map } = await renderLoaded(
      mapData({
        points: {
          type: "FeatureCollection",
          features: [point("a", "truck", -90, 35)],
        },
      }),
    );
    expect(map.jumpTo).toHaveBeenCalledWith({ center: [-90, 35], zoom: 6 });
    expect(map.fitBounds).not.toHaveBeenCalled();
  });

  it("leaves the default view when there is nothing to show", async () => {
    const { map } = await renderLoaded(
      mapData({
        points: { type: "FeatureCollection", features: [] },
        routes: { type: "FeatureCollection", features: [] },
        placed: [],
      }),
    );
    expect(map.fitBounds).not.toHaveBeenCalled();
    expect(map.jumpTo).not.toHaveBeenCalled();
  });

  it("removes the map when it unmounts", async () => {
    const { map, unmount } = await renderLoaded();
    unmount();
    expect(map.removed).toBe(true);
  });

  it("does not rebuild the map when re-rendered with identical data", async () => {
    const { map, rerender } = await renderLoaded();
    rerender(<ShipmentMap data={mapData()} />);
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(h.FakeMap.instances).toHaveLength(1);
    expect(map.removed).toBe(false);
  });

  it("rebuilds the map when the data changes", async () => {
    const { map, rerender } = await renderLoaded();
    rerender(
      <ShipmentMap
        data={mapData({
          points: {
            type: "FeatureCollection",
            features: [point("z", "ship", 10, 10)],
          },
        })}
      />,
    );
    await waitFor(() => expect(h.FakeMap.instances).toHaveLength(2));
    expect(map.removed).toBe(true);
  });
});

describe("ShipmentMap: the lists", () => {
  it("lists packages on the map, each linking to its drawer in map view", async () => {
    await renderLoaded();
    const section = screen.getByRole("region", { name: "On the map" });
    const links = within(section).getAllByRole("link");
    expect(links.map((a) => a.getAttribute("href"))).toEqual([
      "/?view=map&shipment=a",
      "/?view=map&shipment=b",
    ]);
    expect(within(section).getByText("Package a")).toBeInTheDocument();
    expect(
      within(links[1]!).getByRole("img", { name: "Plane" }),
    ).toHaveAttribute("data-mode", "plane");
  });

  it("lists packages that are not on the map yet", async () => {
    await renderLoaded();
    const section = screen.getByRole("region", { name: "Not on the map yet" });
    expect(within(section).getByText("Package c")).toBeInTheDocument();
    expect(within(section).getByRole("link")).toHaveAttribute(
      "href",
      "/?view=map&shipment=c",
    );
  });

  it("hides the 'not on the map yet' list when every package is placed", async () => {
    await renderLoaded(mapData({ unplaced: [] }));
    expect(
      screen.queryByRole("region", { name: "Not on the map yet" }),
    ).not.toBeInTheDocument();
  });

  it("says so when nothing has a location yet", async () => {
    await renderLoaded(
      mapData({
        points: { type: "FeatureCollection", features: [] },
        placed: [],
      }),
    );
    expect(
      screen.getByText("None of your packages has a known location yet."),
    ).toBeInTheDocument();
  });

  it("shows the empty state for a user with no packages", async () => {
    await renderLoaded(mapData({ placed: [], unplaced: [] }));
    expect(
      screen.getByText("No packages yet — add a tracking number above."),
    ).toBeInTheDocument();
  });
});

describe("ShipmentMap: when the map cannot load", () => {
  it("explains it and keeps the lists usable", async () => {
    h.FakeMap.failOnCreate = true;
    render(<ShipmentMap data={mapData()} />);

    expect(await screen.findByRole("status")).toHaveTextContent(
      "The map couldn't load.",
    );
    expect(screen.queryByTestId("shipment-map")).not.toBeInTheDocument();
    expect(screen.getByText("Package a")).toBeInTheDocument();
    expect(screen.getByText("Package c")).toBeInTheDocument();
  });

  it("falls back the same way if drawing on the loaded map fails", async () => {
    render(<ShipmentMap data={mapData()} />);
    await waitFor(() => expect(h.FakeMap.instances).toHaveLength(1));
    const map = h.FakeMap.instances[0]!;
    map.addSource = () => {
      throw new Error("style not ready");
    };

    await map.fire("load");

    expect(await screen.findByRole("status")).toBeInTheDocument();
    expect(screen.getByText("Package a")).toBeInTheDocument();
  });
});
