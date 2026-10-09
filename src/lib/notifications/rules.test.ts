// @vitest-environment node
import { describe, expect, it } from "vitest";
import { STATUSES, type Status } from "@/lib/tracking/status";
import {
  OVERDUE_AFTER_MS,
  OVERDUE_MAX_AGE_MS,
  alertsForUpdate,
  isOverdue,
  kindForStatus,
  overdueDedupeKey,
  overdueWindow,
  utcDay,
  type ShipmentSnapshot,
} from "./rules";

const T1 = new Date("2026-06-10T09:00:00Z");
const T2 = new Date("2026-06-11T09:00:00Z");

const snap = (
  status: Status,
  eta: Date | null = null,
  lastEventAt: Date | null = T1,
): ShipmentSnapshot => ({ status, eta, lastEventAt });

describe("kindForStatus", () => {
  it.each<[Status, string | null]>([
    ["OutForDelivery", "out_for_delivery"],
    ["Delivered", "delivered"],
    ["AvailableForPickup", "delivered"],
    ["Exception", "problem"],
    ["AttemptFail", "problem"],
    ["Pending", null],
    ["InfoReceived", null],
    ["InTransit", null],
    ["Expired", null],
  ])("%s -> %s", (status, kind) => {
    expect(kindForStatus(status)).toBe(kind);
  });

  it("covers every status", () => {
    // Fails if a status is added without deciding whether it alerts.
    expect(STATUSES.map((status) => kindForStatus(status))).toHaveLength(
      STATUSES.length,
    );
  });
});

describe("alertsForUpdate: status", () => {
  it("fires out_for_delivery when the status becomes OutForDelivery", () => {
    expect(
      alertsForUpdate(snap("InTransit"), snap("OutForDelivery", null, T2)),
    ).toEqual([
      {
        kind: "out_for_delivery",
        dedupeKey: `OutForDelivery:${T2.toISOString()}`,
      },
    ]);
  });

  it.each<[Status, string]>([
    ["Delivered", "delivered"],
    ["AvailableForPickup", "delivered"],
    ["Exception", "problem"],
    ["AttemptFail", "problem"],
  ])("fires %s as a %s alert", (status, kind) => {
    const alerts = alertsForUpdate(
      snap("OutForDelivery"),
      snap(status, null, T2),
    );
    expect(alerts).toHaveLength(1);
    expect(alerts[0]?.kind).toBe(kind);
    expect(alerts[0]?.dedupeKey).toBe(`${status}:${T2.toISOString()}`);
  });

  it("fires nothing when the status did not change (a repeated webhook)", () => {
    expect(
      alertsForUpdate(snap("OutForDelivery"), snap("OutForDelivery")),
    ).toEqual([]);
    expect(
      alertsForUpdate(snap("Delivered"), snap("Delivered", null, T2)),
    ).toEqual([]);
  });

  it("fires nothing for statuses that do not alert", () => {
    expect(alertsForUpdate(snap("Pending"), snap("InfoReceived"))).toEqual([]);
    expect(alertsForUpdate(snap("InfoReceived"), snap("InTransit"))).toEqual(
      [],
    );
  });

  it("alerts again for a later out-for-delivery, with a different key", () => {
    const monday = alertsForUpdate(
      snap("InTransit"),
      snap("OutForDelivery", null, T1),
    );
    const tuesday = alertsForUpdate(
      snap("AttemptFail"),
      snap("OutForDelivery", null, T2),
    );
    expect(monday[0]?.dedupeKey).not.toBe(tuesday[0]?.dedupeKey);
  });

  it("gives the same key for the same event however often it is seen", () => {
    const first = alertsForUpdate(
      snap("InTransit"),
      snap("Delivered", null, T2),
    );
    const again = alertsForUpdate(
      snap("InTransit"),
      snap("Delivered", null, T2),
    );
    expect(first).toEqual(again);
  });

  it("copes with a status change that has no event time", () => {
    const alerts = alertsForUpdate(
      snap("Pending"),
      snap("Delivered", null, null),
    );
    expect(alerts[0]?.dedupeKey).toBe("Delivered:no-event");
  });
});

describe("alertsForUpdate: delay", () => {
  const eta = (iso: string) => new Date(iso);

  it("fires when the ETA moves to a later day", () => {
    expect(
      alertsForUpdate(
        snap("InTransit", eta("2026-06-12T18:00:00Z")),
        snap("InTransit", eta("2026-06-14T18:00:00Z")),
      ),
    ).toEqual([{ kind: "delay", dedupeKey: "eta:2026-06-14" }]);
  });

  it("does not fire when the ETA moves earlier or stays on the same day", () => {
    expect(
      alertsForUpdate(
        snap("InTransit", eta("2026-06-14T18:00:00Z")),
        snap("InTransit", eta("2026-06-12T18:00:00Z")),
      ),
    ).toEqual([]);
    expect(
      alertsForUpdate(
        snap("InTransit", eta("2026-06-12T08:00:00Z")),
        snap("InTransit", eta("2026-06-12T20:00:00Z")),
      ),
    ).toEqual([]);
  });

  it("does not fire for the first ETA a shipment gets, or when the ETA disappears", () => {
    expect(
      alertsForUpdate(
        snap("InTransit", null),
        snap("InTransit", eta("2026-06-14T18:00:00Z")),
      ),
    ).toEqual([]);
    expect(
      alertsForUpdate(
        snap("InTransit", eta("2026-06-14T18:00:00Z")),
        snap("InTransit", null),
      ),
    ).toEqual([]);
  });

  it("does not fire once the parcel is delivered or expired", () => {
    for (const status of ["Delivered", "Expired"] as const) {
      expect(
        alertsForUpdate(
          snap("InTransit", eta("2026-06-12T18:00:00Z")),
          snap(status, eta("2026-06-14T18:00:00Z")),
        ).filter((alert) => alert.kind === "delay"),
      ).toEqual([]);
    }
  });

  it("can fire together with a status alert", () => {
    const alerts = alertsForUpdate(
      snap("InTransit", eta("2026-06-12T18:00:00Z")),
      snap("Exception", eta("2026-06-15T18:00:00Z"), T2),
    );
    expect(alerts.map((alert) => alert.kind)).toEqual(["problem", "delay"]);
  });

  it("alerts once per new promised day", () => {
    const a = alertsForUpdate(
      snap("InTransit", eta("2026-06-12T18:00:00Z")),
      snap("InTransit", eta("2026-06-14T18:00:00Z")),
    );
    const b = alertsForUpdate(
      snap("InTransit", eta("2026-06-14T18:00:00Z")),
      snap("InTransit", eta("2026-06-16T18:00:00Z")),
    );
    expect(a[0]?.dedupeKey).toBe("eta:2026-06-14");
    expect(b[0]?.dedupeKey).toBe("eta:2026-06-16");
  });
});

describe("isOverdue", () => {
  const eta = new Date("2026-06-10T12:00:00Z");
  const at = (offsetMs: number) => new Date(eta.getTime() + offsetMs);

  it("is true only once the ETA is more than 24 hours past", () => {
    expect(isOverdue({ status: "InTransit", eta }, at(OVERDUE_AFTER_MS))).toBe(
      false,
    );
    expect(
      isOverdue({ status: "InTransit", eta }, at(OVERDUE_AFTER_MS + 1)),
    ).toBe(true);
    expect(isOverdue({ status: "InTransit", eta }, at(-1000))).toBe(false);
  });

  it.each<Status>(["Delivered", "Expired", "AvailableForPickup"])(
    "is never true for %s",
    (status) => {
      expect(isOverdue({ status, eta }, at(10 * OVERDUE_AFTER_MS))).toBe(false);
    },
  );

  it("is false without an ETA, and for an archived shipment", () => {
    expect(
      isOverdue({ status: "InTransit", eta: null }, at(10 * OVERDUE_AFTER_MS)),
    ).toBe(false);
    expect(
      isOverdue(
        { status: "InTransit", eta, archived: true },
        at(10 * OVERDUE_AFTER_MS),
      ),
    ).toBe(false);
  });

  it.each<Status>(["OutForDelivery", "Exception", "AttemptFail", "Pending"])(
    "is true for an overdue %s",
    (status) => {
      expect(isOverdue({ status, eta }, at(2 * OVERDUE_AFTER_MS))).toBe(true);
    },
  );
});

describe("isOverdue: the age bound", () => {
  const eta = new Date("2026-06-01T12:00:00Z");
  it("stops alerting once the ETA is older than 14 days", () => {
    const edge = new Date(eta.getTime() + OVERDUE_MAX_AGE_MS);
    expect(isOverdue({ status: "InTransit", eta }, edge)).toBe(true);
    expect(
      isOverdue({ status: "InTransit", eta }, new Date(edge.getTime() + 1)),
    ).toBe(false);
  });
});

describe("overdue helpers", () => {
  it("keys one alert per promised day", () => {
    expect(overdueDedupeKey(new Date("2026-06-10T23:59:59Z"))).toBe(
      "overdue:2026-06-10",
    );
    expect(overdueDedupeKey(new Date("2026-06-11T00:00:00Z"))).toBe(
      "overdue:2026-06-11",
    );
  });

  it("scans ETAs from 14 days back up to 24 hours back", () => {
    const now = new Date("2026-06-20T12:00:00Z");
    const window = overdueWindow(now);
    expect(window.to.toISOString()).toBe("2026-06-19T12:00:00.000Z");
    expect(window.from.toISOString()).toBe("2026-06-06T12:00:00.000Z");
  });

  it("formats the UTC day", () => {
    expect(utcDay(new Date("2026-06-10T23:30:00-05:00"))).toBe("2026-06-11");
  });
});
