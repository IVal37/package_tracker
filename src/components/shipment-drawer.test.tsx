import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { CheckpointRow, ShipmentRow } from "@/lib/db/shipments";
import { ShipmentDrawer } from "./shipment-drawer";

const { push } = vi.hoisted(() => ({ push: vi.fn() }));
vi.mock("next/navigation", () => ({ useRouter: () => ({ push }) }));

const NOW = new Date("2026-06-10T12:00:00Z");

const shipment: ShipmentRow = {
  id: "11111111-1111-4111-8111-111111111111",
  userId: "u1",
  trackingNumber: "FAKE-OFD-1",
  courier: "fake-courier",
  nickname: "New boots",
  provider: "fake",
  providerTrackerId: "fake:FAKE-OFD-1",
  status: "OutForDelivery",
  eta: new Date("2026-06-10T20:00:00Z"),
  lastEventAt: null,
  archivedAt: null,
  createdAt: NOW,
  updatedAt: NOW,
  lastSyncedAt: NOW,
};

const checkpoint = (id: string, hour: number): CheckpointRow => ({
  id,
  shipmentId: shipment.id,
  providerEventId: id,
  occurredAt: new Date(Date.UTC(2026, 5, 10, hour)),
  eventOrder: null,
  status: "InTransit",
  message: `message ${id}`,
  locationText: `place ${id}`,
  lat: null,
  lng: null,
  mode: null,
  createdAt: NOW,
});

const renderDrawer = (
  deleteAction: (formData: FormData) => Promise<void> = vi.fn(async () => {}),
) => {
  render(
    <ShipmentDrawer
      shipment={shipment}
      checkpoints={[checkpoint("new", 10), checkpoint("old", 2)]}
      now={NOW}
      deleteAction={deleteAction}
    />,
  );
  return { deleteAction };
};

beforeEach(() => {
  push.mockClear();
});

describe("ShipmentDrawer", () => {
  it("shows the shipment details in a dialog titled with the nickname", () => {
    renderDrawer();
    const dialog = screen.getByRole("dialog", { name: "New boots" });
    expect(within(dialog).getByText("FAKE-OFD-1")).toBeInTheDocument();
    expect(within(dialog).getByText("fake-courier")).toBeInTheDocument();
    expect(within(dialog).getByText("Out for delivery")).toBeInTheDocument();
    expect(within(dialog).getByText("Today")).toBeInTheDocument();
  });

  it("falls back to the tracking number as title and 'Unknown' courier", () => {
    render(
      <ShipmentDrawer
        shipment={{ ...shipment, nickname: null, courier: null }}
        checkpoints={[]}
        now={NOW}
        deleteAction={vi.fn(async () => {})}
      />,
    );
    expect(
      screen.getByRole("dialog", { name: "FAKE-OFD-1" }),
    ).toBeInTheDocument();
    expect(screen.getByText("Unknown")).toBeInTheDocument();
  });

  it("renders the timeline newest first", () => {
    renderDrawer();
    const items = screen.getAllByRole("listitem").map((li) => li.textContent);
    expect(items[0]).toContain("message new");
    expect(items[1]).toContain("message old");
  });

  it.each([
    ["Escape", () => userEvent.keyboard("{Escape}")],
    [
      "the close button",
      () => userEvent.click(screen.getByRole("button", { name: "Close" })),
    ],
    [
      "a backdrop click",
      () => userEvent.click(screen.getByTestId("modal-backdrop")),
    ],
  ])("navigates back to the list on %s", async (_name, close) => {
    renderDrawer();
    await close();
    expect(push).toHaveBeenCalledWith("/");
  });

  it("asks for confirmation before deleting, and Cancel backs out", async () => {
    const { deleteAction } = renderDrawer();

    await userEvent.click(screen.getByRole("button", { name: "Delete" }));
    expect(screen.getByText("Delete this package?")).toBeInTheDocument();
    expect(deleteAction).not.toHaveBeenCalled();

    await userEvent.click(screen.getByRole("button", { name: "Cancel" }));
    expect(screen.queryByText("Delete this package?")).not.toBeInTheDocument();
    expect(deleteAction).not.toHaveBeenCalled();
  });

  it("submits the shipment id when deletion is confirmed", async () => {
    const deleteAction = vi.fn(async (formData: FormData) => {
      expect(formData.get("shipmentId")).toBe(shipment.id);
    });
    renderDrawer(deleteAction);

    await userEvent.click(screen.getByRole("button", { name: "Delete" }));
    await userEvent.click(screen.getByRole("button", { name: "Yes, delete" }));

    expect(deleteAction).toHaveBeenCalledOnce();
  });
});
