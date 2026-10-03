import { render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { ShipmentListItem } from "@/lib/db/shipments";

const mocks = vi.hoisted(() => ({
  requireUser: vi.fn(),
  listShipments: vi.fn(),
  getShipmentDetail: vi.fn(),
  db: { marker: "db" },
}));

vi.mock("@/lib/auth/session", () => ({ requireUser: mocks.requireUser }));
vi.mock("@/lib/db/client", () => ({ getDb: () => mocks.db }));
vi.mock("@/lib/db/shipments", () => ({
  listShipments: mocks.listShipments,
  getShipmentDetail: mocks.getShipmentDetail,
}));
vi.mock("next/navigation", () => ({ useRouter: () => ({ push: vi.fn() }) }));
// Server actions are imported by the page but never invoked here.
vi.mock("./actions", () => ({
  addPackageAction: vi.fn(),
  deletePackageAction: vi.fn(),
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
  lastCheckpoint: null,
});

const renderHome = async (search: { shipment?: string | string[] } = {}) =>
  render(await Home({ searchParams: Promise.resolve(search) }));

beforeEach(() => {
  vi.clearAllMocks();
  mocks.requireUser.mockResolvedValue(USER);
  mocks.listShipments.mockResolvedValue([]);
  mocks.getShipmentDetail.mockResolvedValue(null);
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
