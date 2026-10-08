import { render, screen, within } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import type { ShipmentListItem } from "@/lib/db/shipments";
import { groupShipmentsByStatus } from "@/lib/shipments/grouping";
import { ShipmentList } from "./shipment-list";

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
