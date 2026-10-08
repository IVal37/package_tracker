import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import type { ShipmentListItem } from "@/lib/db/shipments";
import { groupShipmentsByStatus } from "@/lib/shipments/grouping";
import { ShipmentList, type OrderedItem } from "./shipment-list";

const NOW = new Date("2026-06-10T12:00:00Z");

const shipment = (
  id: string,
  status: ShipmentListItem["status"],
  overrides: Partial<ShipmentListItem> = {},
): ShipmentListItem => ({
  id,
  userId: "u1",
  trackingNumber: `TN-${id}`,
  courier: null,
  nickname: null,
  provider: "fake",
  providerTrackerId: null,
  status,
  eta: null,
  lastEventAt: null,
  archivedAt: null,
  createdAt: new Date("2026-06-01T00:00:00Z"),
  updatedAt: new Date("2026-06-01T00:00:00Z"),
  destinationText: null,
  destinationKey: null,
  lastSyncedAt: new Date("2026-06-01T00:00:00Z"),
  lastCheckpoint: null,
  ...overrides,
});

const renderList = (items: ShipmentListItem[]) =>
  render(<ShipmentList groups={groupShipmentsByStatus(items)} now={NOW} />);

describe("ShipmentList", () => {
  it("shows the empty state when there are no packages", () => {
    renderList([]);
    expect(
      screen.getByText("No packages yet — add a tracking number above."),
    ).toBeInTheDocument();
  });

  it("renders a section per status, in display order, with counts", () => {
    renderList([
      shipment("a", "Delivered"),
      shipment("b", "InTransit"),
      shipment("c", "InTransit"),
      shipment("d", "OutForDelivery"),
    ]);

    const headings = screen
      .getAllByRole("heading", { level: 2 })
      .map((h) => h.textContent?.replace(/\s+/g, " ").trim());
    expect(headings).toEqual([
      "Out for delivery (1)",
      "In transit (2)",
      "Delivered (1)",
    ]);
  });

  it("shows the nickname with the number beneath it, or just the number", () => {
    renderList([
      shipment("a", "InTransit", { nickname: "New boots" }),
      shipment("b", "InTransit"),
    ]);
    expect(screen.getByText("New boots")).toBeInTheDocument();
    expect(screen.getByText("TN-a")).toBeInTheDocument();
    expect(screen.getByText("TN-b")).toBeInTheDocument();
  });

  it("shows the status chip, ETA and last checkpoint", () => {
    renderList([
      shipment("a", "OutForDelivery", {
        eta: new Date("2026-06-10T20:00:00Z"),
        lastCheckpoint: {
          message: "Out for delivery",
          locationText: "SAN FRANCISCO, CA",
          occurredAt: new Date("2026-06-10T11:00:00Z"),
        },
      }),
    ]);

    const row = screen.getByRole("link");
    expect(within(row).getByText("Today")).toBeInTheDocument();
    expect(
      within(row).getByText(
        /Out for delivery · SAN FRANCISCO, CA \(1 hour ago\)/,
      ),
    ).toBeInTheDocument();
    expect(row.querySelector('[data-status="OutForDelivery"]')).not.toBeNull();
  });

  it("shows 'No ETA' and omits the checkpoint line when there is none", () => {
    renderList([shipment("a", "Pending")]);
    expect(screen.getByText("No ETA")).toBeInTheDocument();
    expect(screen.queryByText(/ago\)/)).not.toBeInTheDocument();
  });

  it("links each row to its detail drawer", () => {
    renderList([shipment("abc", "InTransit")]);
    expect(screen.getByRole("link")).toHaveAttribute("href", "/?shipment=abc");
  });

  it("renders a chip for every status when each is present", () => {
    renderList([
      shipment("1", "Pending"),
      shipment("2", "InfoReceived"),
      shipment("3", "InTransit"),
      shipment("4", "OutForDelivery"),
      shipment("5", "AttemptFail"),
      shipment("6", "Delivered"),
      shipment("7", "AvailableForPickup"),
      shipment("8", "Exception"),
      shipment("9", "Expired"),
    ]);
    expect(screen.getAllByRole("link")).toHaveLength(9);
    expect(screen.getAllByRole("heading", { level: 2 })).toHaveLength(9);
  });
});

describe("ShipmentList: Ordered section", () => {
  const order = (
    id: string,
    overrides: Partial<OrderedItem> = {},
  ): OrderedItem => ({
    id,
    retailer: "Target",
    item: "Desk lamp",
    orderNumber: "1001",
    createdAt: new Date("2026-06-08T12:00:00Z"),
    ...overrides,
  });

  const headingsOf = () =>
    screen
      .getAllByRole("heading", { level: 2 })
      .map((h) => h.textContent?.replace(/\s+/g, " ").trim());

  const renderWithOrders = (
    items: ShipmentListItem[],
    orders: OrderedItem[],
    dismissOrderAction?: (formData: FormData) => Promise<void>,
  ) =>
    render(
      <ShipmentList
        groups={groupShipmentsByStatus(items)}
        now={NOW}
        orders={orders}
        dismissOrderAction={dismissOrderAction}
      />,
    );

  it("sits just before Delivered", () => {
    renderWithOrders(
      [
        shipment("a", "Delivered"),
        shipment("b", "InTransit"),
        shipment("c", "Expired"),
      ],
      [order("o1")],
    );
    expect(headingsOf()).toEqual([
      "In transit (1)",
      "Ordered (1)",
      "Delivered (1)",
      "Expired (1)",
    ]);
  });

  it("goes last when nothing is delivered", () => {
    renderWithOrders([shipment("b", "InTransit")], [order("o1")]);
    expect(headingsOf()).toEqual(["In transit (1)", "Ordered (1)"]);
  });

  it("replaces the empty state when there are only orders", () => {
    renderWithOrders([], [order("o1"), order("o2")]);
    expect(screen.queryByText(/No packages yet/)).not.toBeInTheDocument();
    expect(headingsOf()).toEqual(["Ordered (2)"]);
  });

  it("is absent when there are no orders", () => {
    renderWithOrders([shipment("b", "InTransit")], []);
    expect(headingsOf()).toEqual(["In transit (1)"]);
  });

  it("shows the item, retailer, order number and age", () => {
    renderWithOrders([], [order("o1")]);
    const row = screen.getByRole("listitem");
    expect(within(row).getByText("Desk lamp")).toBeInTheDocument();
    expect(within(row).getByText("Target · #1001")).toBeInTheDocument();
    expect(row).toHaveTextContent("ordered 2 days ago");
  });

  it("falls back to the retailer, then a generic title, when parts are missing", () => {
    renderWithOrders(
      [],
      [
        order("o1", { item: null, orderNumber: null }),
        order("o2", { item: null, retailer: null, orderNumber: "77" }),
        order("o3", { item: null, retailer: null, orderNumber: null }),
      ],
    );
    const [first, second, third] = screen.getAllByRole("listitem");
    expect(first).toHaveTextContent(/^Target/);
    expect(first).not.toHaveTextContent("#");
    expect(second).toHaveTextContent(/^Order#77/);
    expect(third).toHaveTextContent(/^Order/);
  });

  it("renders email-supplied strings as text, never as HTML", () => {
    const { container } = renderWithOrders(
      [],
      [
        order("o1", {
          item: "<script>alert(1)</script>",
          retailer: "<img src=x onerror=alert(1)>",
        }),
      ],
    );
    expect(screen.getByText("<script>alert(1)</script>")).toBeInTheDocument();
    expect(container.querySelector("script")).toBeNull();
    expect(container.querySelector("img")).toBeNull();
  });

  it("submits a dismiss form carrying only the order id", async () => {
    const action = vi.fn(async (_formData: FormData) => {});
    renderWithOrders([], [order("o1")], action);

    await userEvent.click(screen.getByRole("button", { name: "Dismiss" }));

    expect(action).toHaveBeenCalledOnce();
    const data = action.mock.calls[0]![0];
    expect([...data.keys()]).toEqual(["orderId"]);
    expect(data.get("orderId")).toBe("o1");
  });

  it("has no Dismiss button without an action", () => {
    renderWithOrders([], [order("o1")]);
    expect(
      screen.queryByRole("button", { name: "Dismiss" }),
    ).not.toBeInTheDocument();
  });
});
