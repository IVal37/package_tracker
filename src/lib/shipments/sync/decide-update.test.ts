import { describe, expect, it } from "vitest";
import type {
  NormalizedEvent,
  NormalizedShipment,
  Status,
} from "@/lib/tracking";
import { decideShipmentUpdate, type ShipmentState } from "./decide-update";

const NOW = new Date("2026-06-10T12:00:00Z");
const at = (hour: number) =>
  new Date(`2026-06-01T${String(hour).padStart(2, "0")}:00:00Z`);

const event = (hour: number, status: Status): NormalizedEvent => ({
  providerEventId: `e${hour}`,
  occurredAt: at(hour),
  status,
  message: null,
  locationText: null,
  courierCode: null,
  order: null,
});

const incoming = (
  status: Status,
  hours: number[],
  eta: Date | null = null,
): NormalizedShipment => ({
  providerTrackerId: "t1",
  trackingNumber: "TRACK12345",
  courier: null,
  status,
  eta,
  lastEventAt: hours[0] === undefined ? null : at(hours[0]),
  destination: null,
  events: hours.map((h) => event(h, status)),
});

const state = (
  status: Status,
  lastEventHour: number | null,
  eta: Date | null = null,
): ShipmentState => ({
  status,
  eta,
  lastEventAt: lastEventHour === null ? null : at(lastEventHour),
});

const OLD_ETA = new Date("2026-06-05T00:00:00Z");
const NEW_ETA = new Date("2026-06-04T00:00:00Z");

describe("decideShipmentUpdate", () => {
  const cases: {
    name: string;
    current: ShipmentState;
    update: NormalizedShipment;
    expected: {
      status: Status;
      eta: Date | null;
      lastEventHour: number | null;
    };
  }[] = [
    {
      name: "a newer event moves status, ETA and last event forward",
      current: state("InTransit", 8, OLD_ETA),
      update: incoming("OutForDelivery", [10], NEW_ETA),
      expected: { status: "OutForDelivery", eta: NEW_ETA, lastEventHour: 10 },
    },
    {
      name: "a late older event keeps status, ETA and last event",
      current: state("OutForDelivery", 10, OLD_ETA),
      update: incoming("InTransit", [8], NEW_ETA),
      expected: { status: "OutForDelivery", eta: OLD_ETA, lastEventHour: 10 },
    },
    {
      name: "an event with the same time is applied (repeat delivery is a no-op)",
      current: state("OutForDelivery", 10, OLD_ETA),
      update: incoming("OutForDelivery", [10], OLD_ETA),
      expected: { status: "OutForDelivery", eta: OLD_ETA, lastEventHour: 10 },
    },
    {
      name: "a shipment with no stored events takes the incoming state",
      current: state("Pending", null),
      update: incoming("InTransit", [9], NEW_ETA),
      expected: { status: "InTransit", eta: NEW_ETA, lastEventHour: 9 },
    },
    {
      name: "no incoming events leave a shipment that has history alone",
      current: state("InTransit", 8, OLD_ETA),
      update: incoming("Pending", []),
      expected: { status: "InTransit", eta: OLD_ETA, lastEventHour: 8 },
    },
    {
      name: "no incoming events apply to a shipment with no history",
      current: state("Pending", null),
      update: incoming("InfoReceived", [], NEW_ETA),
      expected: { status: "InfoReceived", eta: NEW_ETA, lastEventHour: null },
    },
    {
      name: "a re-attempt after a failed attempt is allowed when newer",
      current: state("AttemptFail", 8),
      update: incoming("OutForDelivery", [11]),
      expected: { status: "OutForDelivery", eta: null, lastEventHour: 11 },
    },
    {
      name: "recovery from an exception is allowed when newer",
      current: state("Exception", 8),
      update: incoming("InTransit", [12]),
      expected: { status: "InTransit", eta: null, lastEventHour: 12 },
    },
    {
      name: "Delivered is not undone by an older in-transit event",
      current: state("Delivered", 15),
      update: incoming("InTransit", [9]),
      expected: { status: "Delivered", eta: null, lastEventHour: 15 },
    },
    {
      name: "the newest of several events decides",
      current: state("InTransit", 8),
      update: incoming("Delivered", [14, 12, 6]),
      expected: { status: "Delivered", eta: null, lastEventHour: 14 },
    },
  ];

  it.each(cases)("$name", ({ current, update, expected }) => {
    const result = decideShipmentUpdate(current, update, NOW);
    expect(result.status).toBe(expected.status);
    expect(result.eta).toEqual(expected.eta);
    expect(result.lastEventAt).toEqual(
      expected.lastEventHour === null ? null : at(expected.lastEventHour),
    );
  });

  it("always sets lastSyncedAt to now, even when nothing else changes", () => {
    const result = decideShipmentUpdate(
      state("OutForDelivery", 10),
      incoming("InTransit", [8]),
      NOW,
    );
    expect(result.lastSyncedAt).toEqual(NOW);
  });
});
