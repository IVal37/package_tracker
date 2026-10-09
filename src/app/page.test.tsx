import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type {
  CheckpointDetail,
  MapShipment,
  ShipmentListItem,
} from "@/lib/db/shipments";
import type { MapData } from "@/lib/geo/map-data";

const mocks = vi.hoisted(() => ({
  requireUser: vi.fn(),
  listShipments: vi.fn(),
  listMapShipments: vi.fn(),
  getShipmentDetail: vi.fn(),
  listOrderPlaceholders: vi.fn(),
  getOrderForShipment: vi.fn(),
  push: vi.fn(),
  db: { marker: "db" },
}));

vi.mock("@/lib/auth/session", () => ({ requireUser: mocks.requireUser }));
vi.mock("@/lib/db/client", () => ({ getDb: () => mocks.db }));
vi.mock("@/lib/db/shipments", () => ({
  listShipments: mocks.listShipments,
  listMapShipments: mocks.listMapShipments,
  getShipmentDetail: mocks.getShipmentDetail,
}));
vi.mock("@/lib/db/orders", () => ({
  listOrderPlaceholders: mocks.listOrderPlaceholders,
  getOrderForShipment: mocks.getOrderForShipment,
}));
vi.mock("next/navigation", () => ({ useRouter: () => ({ push: mocks.push }) }));
// The real map needs WebGL; it has its own tests. This stub shows what it got.
vi.mock("@/components/shipment-map", () => ({
  ShipmentMap: ({ data }: { data: MapData }) => (
    <div data-testid="map-stub">
      {data.placed.map((p) => p.name).join(",")}|
      {data.unplaced.map((p) => p.name).join(",")}
    </div>
  ),
}));
// Server actions are imported by the page but never invoked here.
vi.mock("./actions", () => ({
  addPackageAction: vi.fn(),
  deletePackageAction: vi.fn(),
  dismissOrderAction: vi.fn(),
}));
vi.mock("./settings/actions", () => ({
  removePushSubscriptionAction: vi.fn(),
}));
vi.mock("./sign-in/actions", () => ({ signOut: vi.fn() }));

import Home from "./page";

const NOW = new Date("2026-06-10T12:00:00Z");
const USER = { id: "session-user", email: "a@example.test" };

const item = (
  id: string,
  status: ShipmentListItem["status"],
): ShipmentListItem => ({
  id,
  userId: USER.id,
  trackingNumber: `TN-${id}`,
  courier: null,
  nickname: null,
  provider: "fake",
  providerTrackerId: null,
  status,
  eta: null,
  lastEventAt: null,
  archivedAt: null,
  createdAt: NOW,
  updatedAt: NOW,
  destinationText: null,
  destinationKey: null,
  lastSyncedAt: NOW,
  lastCheckpoint: null,
});

const renderHome = async (
  search: { shipment?: string | string[]; view?: string | string[] } = {},
) => render(await Home({ searchParams: Promise.resolve(search) }));

const detailCheckpoint = (
  overrides: Partial<CheckpointDetail> = {},
): CheckpointDetail => ({
  id: "c1",
  shipmentId: "abc",
  providerEventId: "c1",
  occurredAt: new Date("2026-06-10T08:00:00Z"),
  eventOrder: null,
  status: "InTransit",
  message: "Arrived at facility",
  locationText: "MEMPHIS, TN",
  locationKey: "memphis, tn",
  createdAt: NOW,
  lat: null,
  lng: null,
  ...overrides,
});

const mapShipment = (id: string, located: boolean): MapShipment => ({
  id,
  name: `Package ${id}`,
  status: "InTransit",
  destination: null,
  checkpoints: [
    {
      status: "InTransit",
      message: "Arrived at facility",
      locationText: "MEMPHIS, TN",
      occurredAt: new Date("2026-06-10T08:00:00Z"),
      point: located ? { lat: 35.1, lng: -90 } : null,
    },
  ],
});

beforeEach(() => {
  vi.clearAllMocks();
  mocks.requireUser.mockResolvedValue(USER);
  mocks.listShipments.mockResolvedValue([]);
  mocks.listMapShipments.mockResolvedValue([]);
  mocks.getShipmentDetail.mockResolvedValue(null);
  mocks.listOrderPlaceholders.mockResolvedValue([]);
  mocks.getOrderForShipment.mockResolvedValue(null);
});

describe("Home page", () => {
  it("requires sign-in before reading anything", async () => {
    mocks.requireUser.mockRejectedValue(new Error("NEXT_REDIRECT /sign-in"));
    await expect(Home({ searchParams: Promise.resolve({}) })).rejects.toThrow(
      "NEXT_REDIRECT /sign-in",
    );
    expect(mocks.listShipments).not.toHaveBeenCalled();
  });

  it("renders the header, add form and the user's grouped shipments", async () => {
    mocks.listShipments.mockResolvedValue([
      item("a", "Delivered"),
      item("b", "OutForDelivery"),
    ]);
    await renderHome();

    expect(mocks.listShipments).toHaveBeenCalledWith(mocks.db, "session-user");
    expect(screen.getByText("a@example.test")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Upgrade" })).toBeInTheDocument();
    expect(
      screen.getByRole("heading", { name: "Add a package" }),
    ).toBeInTheDocument();
    const headings = screen
      .getAllByRole("heading", { level: 2 })
      .map((h) => h.textContent?.replace(/\s+/g, " ").trim());
    expect(headings).toContain("Out for delivery (1)");
    expect(headings.indexOf("Out for delivery (1)")).toBeLessThan(
      headings.indexOf("Delivered (1)"),
    );
  });

  it("shows the empty state for a user with no packages", async () => {
    await renderHome();
    expect(screen.getByText(/No packages yet/)).toBeInTheDocument();
  });

  it("loads the drawer for ?shipment=, scoped to the session user", async () => {
    mocks.getShipmentDetail.mockResolvedValue({
      shipment: item("abc", "InTransit"),
      checkpoints: [],
    });
    await renderHome({ shipment: "abc" });

    expect(mocks.getShipmentDetail).toHaveBeenCalledWith(
      mocks.db,
      "session-user",
      "abc",
    );
    expect(screen.getByRole("dialog", { name: "TN-abc" })).toBeInTheDocument();
  });

  it("renders no drawer when the id is missing or belongs to someone else", async () => {
    mocks.getShipmentDetail.mockResolvedValue(null);
    await renderHome({ shipment: "someone-elses-id" });
    expect(mocks.getShipmentDetail).toHaveBeenCalled();
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });

  it("ignores an array-valued ?shipment= param", async () => {
    await renderHome({ shipment: ["a", "b"] });
    expect(mocks.getShipmentDetail).not.toHaveBeenCalled();
  });
});

describe("Home page: orders from forwarded email", () => {
  const placeholder = {
    id: "o1",
    userId: USER.id,
    retailer: "Target",
    retailerKey: "target",
    item: "Desk lamp",
    orderNumber: "1001",
    shipmentId: null,
    sourceEmailId: null,
    createdAt: NOW,
  };

  it("lists the session user's unshipped orders in an Ordered section", async () => {
    mocks.listShipments.mockResolvedValue([item("a", "Delivered")]);
    mocks.listOrderPlaceholders.mockResolvedValue([placeholder]);
    await renderHome();

    expect(mocks.listOrderPlaceholders).toHaveBeenCalledExactlyOnceWith(
      mocks.db,
      "session-user",
    );
    expect(screen.getByText("Desk lamp")).toBeInTheDocument();
    const headings = screen
      .getAllByRole("heading", { level: 2 })
      .map((h) => h.textContent?.replace(/\s+/g, " ").trim());
    expect(headings.indexOf("Ordered (1)")).toBeLessThan(
      headings.indexOf("Delivered (1)"),
    );
  });

  it("does not load orders for the map", async () => {
    await renderHome({ view: "map" });
    expect(mocks.listOrderPlaceholders).not.toHaveBeenCalled();
  });

  it("shows the order in the drawer, looked up for the session user and the found shipment", async () => {
    mocks.getShipmentDetail.mockResolvedValue({
      shipment: item("abc", "InTransit"),
      checkpoints: [],
    });
    mocks.getOrderForShipment.mockResolvedValue({
      ...placeholder,
      shipmentId: "abc",
    });
    await renderHome({ shipment: "abc" });

    expect(mocks.getOrderForShipment).toHaveBeenCalledWith(
      mocks.db,
      "session-user",
      "abc",
    );
    expect(screen.getByRole("dialog")).toHaveTextContent(
      "Ordered from Target · #1001",
    );
  });

  it("does not look up an order when there is no drawer", async () => {
    mocks.getShipmentDetail.mockResolvedValue(null);
    await renderHome({ shipment: "someone-elses-id" });
    expect(mocks.getOrderForShipment).not.toHaveBeenCalled();
  });
});

describe("Home page: list and map views", () => {
  it("shows the list by default, with the toggle on List", async () => {
    mocks.listShipments.mockResolvedValue([item("a", "InTransit")]);
    await renderHome();

    expect(screen.getByRole("link", { name: "List" })).toHaveAttribute(
      "aria-current",
      "page",
    );
    expect(screen.getByText("TN-a")).toBeInTheDocument();
    expect(screen.queryByTestId("map-stub")).not.toBeInTheDocument();
    expect(mocks.listMapShipments).not.toHaveBeenCalled();
  });

  it("shows the map for ?view=map, loading map data for the session user only", async () => {
    mocks.listMapShipments.mockResolvedValue([
      mapShipment("a", true),
      mapShipment("b", false),
    ]);
    await renderHome({ view: "map" });

    expect(mocks.listMapShipments).toHaveBeenCalledExactlyOnceWith(
      mocks.db,
      "session-user",
    );
    expect(mocks.listShipments).not.toHaveBeenCalled();
    expect(screen.getByTestId("map-stub")).toHaveTextContent(
      "Package a|Package b",
    );
    expect(screen.getByRole("link", { name: "Map" })).toHaveAttribute(
      "aria-current",
      "page",
    );
    // The add form stays available in both views.
    expect(
      screen.getByRole("heading", { name: "Add a package" }),
    ).toBeInTheDocument();
  });

  it.each([["bogus"], [["map", "list"]], [undefined]])(
    "falls back to the list for ?view=%j",
    async (view) => {
      await renderHome({ view });
      expect(mocks.listShipments).toHaveBeenCalled();
      expect(mocks.listMapShipments).not.toHaveBeenCalled();
    },
  );

  it("closes the drawer back to the list when opened from the list", async () => {
    mocks.getShipmentDetail.mockResolvedValue({
      shipment: item("abc", "InTransit"),
      checkpoints: [],
    });
    await renderHome({ shipment: "abc" });

    await userEvent.keyboard("{Escape}");

    expect(mocks.push).toHaveBeenCalledWith("/");
  });

  it("closes the drawer back to the map when opened from the map", async () => {
    mocks.getShipmentDetail.mockResolvedValue({
      shipment: item("abc", "InTransit"),
      checkpoints: [],
    });
    await renderHome({ view: "map", shipment: "abc" });

    await userEvent.keyboard("{Escape}");

    expect(mocks.push).toHaveBeenCalledWith("/?view=map");
    expect(screen.getByTestId("map-stub")).toBeInTheDocument();
  });

  it("shows a best-guess mode in the drawer, from the newest checkpoint", async () => {
    mocks.getShipmentDetail.mockResolvedValue({
      shipment: item("abc", "InTransit"),
      checkpoints: [
        detailCheckpoint({
          id: "new",
          message: "Departed origin airport",
          occurredAt: new Date("2026-06-10T09:00:00Z"),
        }),
        detailCheckpoint({
          id: "old",
          occurredAt: new Date("2026-06-09T09:00:00Z"),
        }),
      ],
    });
    await renderHome({ shipment: "abc" });

    const dialog = screen.getByRole("dialog");
    expect(dialog).toHaveTextContent("Moving by");
    expect(dialog).toHaveTextContent("Plane");
    expect(dialog).toHaveTextContent("(best guess)");
  });

  it("measures a long hop between geocoded checkpoints in time order", async () => {
    mocks.getShipmentDetail.mockResolvedValue({
      shipment: item("abc", "InTransit"),
      // Newest first, as the query returns them: Memphis -> Los Angeles in 10 h.
      checkpoints: [
        detailCheckpoint({
          id: "new",
          message: "Departed facility",
          locationText: "LOS ANGELES, CA",
          lat: 34.05,
          lng: -118.24,
          occurredAt: new Date("2026-06-10T10:00:00Z"),
        }),
        detailCheckpoint({
          id: "old",
          message: "Arrived at facility",
          lat: 35.15,
          lng: -90.05,
          occurredAt: new Date("2026-06-10T00:00:00Z"),
        }),
      ],
    });
    await renderHome({ shipment: "abc" });

    expect(screen.getByRole("dialog")).toHaveTextContent("Plane");
  });
});

describe("Home page: offline", () => {
  it("is ready to say when the list is from, if it is opened offline", async () => {
    vi.spyOn(navigator, "onLine", "get").mockReturnValue(false);
    await renderHome();
    expect(screen.getByRole("status")).toHaveTextContent(
      "You're offline. Showing your list as it was on",
    );
    vi.restoreAllMocks();
  });

  it("shows no offline notice while online", async () => {
    await renderHome();
    expect(screen.queryByText(/You're offline/)).not.toBeInTheDocument();
  });
});
