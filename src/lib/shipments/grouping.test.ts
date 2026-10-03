import { describe, expect, it } from "vitest";
import { STATUSES, type Status } from "@/lib/tracking";
import {
  STATUS_DISPLAY_ORDER,
  STATUS_LABELS,
  compareShipments,
  groupShipmentsByStatus,
} from "./grouping";

const d = (iso: string) => new Date(iso);

interface Item {
  id: string;
  status: Status;
  eta: Date | null;
  lastEventAt: Date | null;
  createdAt: Date;
}

const item = (
  id: string,
  status: Status,
  overrides: Partial<Item> = {},
): Item => ({
  id,
  status,
  eta: null,
  lastEventAt: null,
  createdAt: d("2026-01-01T00:00:00Z"),
  ...overrides,
});

describe("status constants", () => {
  it("orders every status exactly once", () => {
    expect([...STATUS_DISPLAY_ORDER].sort()).toEqual([...STATUSES].sort());
  });

  it("has a label for every status", () => {
    for (const status of STATUSES) {
      expect(STATUS_LABELS[status]).toBeTruthy();
    }
    expect(STATUS_LABELS.AttemptFail).toBe("Delivery attempted");
    expect(STATUS_LABELS.AvailableForPickup).toBe("Ready for pickup");
  });
});

describe("compareShipments", () => {
  it("sorts the soonest ETA first", () => {
    const early = item("early", "InTransit", {
      eta: d("2026-02-01T00:00:00Z"),
    });
    const late = item("late", "InTransit", { eta: d("2026-02-05T00:00:00Z") });
    expect([late, early].sort(compareShipments).map((i) => i.id)).toEqual([
      "early",
      "late",
    ]);
  });

  it("puts shipments with no ETA after those with one", () => {
    const withEta = item("with", "InTransit", {
      eta: d("2026-03-01T00:00:00Z"),
    });
    const without = item("without", "InTransit");
    expect([without, withEta].sort(compareShipments).map((i) => i.id)).toEqual([
      "with",
      "without",
    ]);
  });

  it("breaks ETA ties by most recent activity, nulls last", () => {
    const eta = d("2026-02-01T00:00:00Z");
    const recent = item("recent", "InTransit", {
      eta,
      lastEventAt: d("2026-01-10T00:00:00Z"),
    });
    const older = item("older", "InTransit", {
      eta,
      lastEventAt: d("2026-01-05T00:00:00Z"),
    });
    const none = item("none", "InTransit", { eta });
    expect(
      [none, older, recent].sort(compareShipments).map((i) => i.id),
    ).toEqual(["recent", "older", "none"]);
  });

  it("breaks remaining ties by newest created first", () => {
    const newer = item("newer", "InTransit", {
      createdAt: d("2026-01-09T00:00:00Z"),
    });
    const older = item("older", "InTransit", {
      createdAt: d("2026-01-02T00:00:00Z"),
    });
    expect([older, newer].sort(compareShipments).map((i) => i.id)).toEqual([
      "newer",
      "older",
    ]);
  });
});

describe("groupShipmentsByStatus", () => {
  it("returns groups in display order, hiding empty ones", () => {
    const groups = groupShipmentsByStatus([
      item("1", "Delivered"),
      item("2", "InTransit"),
      item("3", "OutForDelivery"),
      item("4", "Exception"),
    ]);
    expect(groups.map((g) => g.status)).toEqual([
      "OutForDelivery",
      "Exception",
      "InTransit",
      "Delivered",
    ]);
    expect(groups.map((g) => g.label)).toEqual([
      "Out for delivery",
      "Exception",
      "In transit",
      "Delivered",
    ]);
  });

  it("sorts within each group", () => {
    const [group] = groupShipmentsByStatus([
      item("late", "InTransit", { eta: d("2026-02-09T00:00:00Z") }),
      item("none", "InTransit"),
      item("early", "InTransit", { eta: d("2026-02-01T00:00:00Z") }),
    ]);
    expect(group?.shipments.map((s) => s.id)).toEqual([
      "early",
      "late",
      "none",
    ]);
  });

  it("returns no groups for no shipments", () => {
    expect(groupShipmentsByStatus([])).toEqual([]);
  });

  it("covers all 9 statuses without dropping any shipment", () => {
    const all = STATUSES.map((status) => item(status, status));
    const groups = groupShipmentsByStatus(all);
    expect(groups).toHaveLength(9);
    expect(groups.flatMap((g) => g.shipments)).toHaveLength(9);
  });

  it("does not mutate its input", () => {
    const input = [
      item("b", "InTransit", { eta: d("2026-02-09T00:00:00Z") }),
      item("a", "InTransit", { eta: d("2026-02-01T00:00:00Z") }),
    ];
    groupShipmentsByStatus(input);
    expect(input.map((i) => i.id)).toEqual(["b", "a"]);
  });
});
