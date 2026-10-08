// @vitest-environment node
import { describe, expect, it } from "vitest";
import {
  InvalidTrackingNumberError,
  ProviderResponseError,
  TrackerNotFoundError,
  WebhookAuthError,
} from "../errors";
import { FakeProvider } from "./provider";

const NOW = new Date("2026-06-01T12:00:00.000Z");
const SECRET = "fake-secret";

const make = () => new FakeProvider({ webhookSecret: SECRET, now: () => NOW });
const bearer = (secret = SECRET) =>
  new Headers({ authorization: `Bearer ${secret}` });

describe("FakeProvider scenarios", () => {
  it.each([
    ["FAKE-TRANSIT-1", "InTransit", 3],
    ["FAKE-OFD-1", "OutForDelivery", 3],
    ["FAKE-DELIVERED-1", "Delivered", 5],
    ["FAKE-EXCEPTION-1", "Exception", 3],
    ["FAKE-PENDING-1", "Pending", 0],
    ["FAKE-AIR-1", "InTransit", 4],
    ["PLAINNUMBER123", "InTransit", 3],
  ])("%s is %s with %i events", async (number, status, eventCount) => {
    const shipment = await make().createTracking({ trackingNumber: number });
    expect(shipment.status).toBe(status);
    expect(shipment.events).toHaveLength(eventCount);
  });

  it.each([
    ["FAKE-TRANSIT-1", "SAN FRANCISCO, CA, US"],
    ["FAKE-OFD-1", "SAN FRANCISCO, CA, US"],
    ["FAKE-DELIVERED-1", "SAN FRANCISCO, CA, US"],
    ["FAKE-EXCEPTION-1", "DENVER, CO, US"],
    ["FAKE-PENDING-1", "PORTLAND, OR, US"],
    ["FAKE-AIR-1", "SAN DIEGO, CA, US"],
    ["PLAINNUMBER123", "SAN FRANCISCO, CA, US"],
  ])("%s heads to %s", async (number, destination) => {
    const shipment = await make().createTracking({ trackingNumber: number });
    expect(shipment.destination).toBe(destination);
  });

  it("a pending package has a destination but no events (destination-pin case)", async () => {
    const shipment = await make().createTracking({
      trackingNumber: "FAKE-PENDING-1",
    });
    expect(shipment.events).toHaveLength(0);
    expect(shipment.destination).not.toBeNull();
  });

  it("throws InvalidTrackingNumberError for FAKE-INVALID-*", async () => {
    await expect(
      make().createTracking({ trackingNumber: "FAKE-INVALID-1" }),
    ).rejects.toBeInstanceOf(InvalidTrackingNumberError);
  });

  it("normalizes the tracking number (spaces, case)", async () => {
    const shipment = await make().createTracking({
      trackingNumber: " fake-ofd-9 ",
    });
    expect(shipment.trackingNumber).toBe("FAKE-OFD-9");
    expect(shipment.status).toBe("OutForDelivery");
  });

  it("returns events newest first with stable ids and times relative to now", async () => {
    const shipment = await make().createTracking({
      trackingNumber: "FAKE-TRANSIT-1",
    });
    expect(shipment.events.map((e) => e.providerEventId)).toEqual([
      "fake:FAKE-TRANSIT-1-e3",
      "fake:FAKE-TRANSIT-1-e2",
      "fake:FAKE-TRANSIT-1-e1",
    ]);
    expect(shipment.events[0]?.occurredAt.toISOString()).toBe(
      "2026-06-01T06:00:00.000Z",
    );
    expect(shipment.lastEventAt).toEqual(shipment.events[0]?.occurredAt);
    expect(shipment.eta?.toISOString()).toBe("2026-06-03T12:00:00.000Z");
    expect(shipment.courier).toBe("fake-courier");
  });

  it("has no ETA when delivered and no courier or events when pending", async () => {
    const delivered = await make().createTracking({
      trackingNumber: "FAKE-DELIVERED-1",
    });
    expect(delivered.eta).toBeNull();

    const pending = await make().createTracking({
      trackingNumber: "FAKE-PENDING-1",
    });
    expect(pending.courier).toBeNull();
    expect(pending.lastEventAt).toBeNull();
  });

  it("gives the air scenario airport wording for mode inference", async () => {
    const { events } = await make().createTracking({
      trackingNumber: "FAKE-AIR-1",
    });
    expect(events.some((e) => /airport/i.test(e.locationText ?? ""))).toBe(
      true,
    );
  });

  it("keeps timestamps fixed across calls even as the clock moves", async () => {
    let clock = NOW;
    const provider = new FakeProvider({
      webhookSecret: SECRET,
      now: () => clock,
    });
    const first = await provider.createTracking({
      trackingNumber: "FAKE-TRANSIT-2",
    });
    clock = new Date(NOW.getTime() + 3_600_000);
    const again = await provider.getTracking(first.providerTrackerId);
    expect(again).toEqual(first);
  });
});

describe("FakeProvider tracker lifecycle", () => {
  it("getTracking rebuilds a tracker it has not seen this process (dev restarts)", async () => {
    const shipment = await make().getTracking("fake:FAKE-DELIVERED-7");
    expect(shipment.status).toBe("Delivered");
    expect(shipment.providerTrackerId).toBe("fake:FAKE-DELIVERED-7");
  });

  it("getTracking rejects ids that did not come from this provider", async () => {
    await expect(make().getTracking("26148317-7502")).rejects.toBeInstanceOf(
      TrackerNotFoundError,
    );
  });

  it("deleteTracking resolves for a known id and rejects an unknown one", async () => {
    await expect(
      make().deleteTracking("fake:FAKE-TRANSIT-1"),
    ).resolves.toBeUndefined();
    await expect(make().deleteTracking("nope")).rejects.toBeInstanceOf(
      TrackerNotFoundError,
    );
  });
});

describe("FakeProvider.parseWebhook", () => {
  it("accepts an authentic webhook and revives dates", async () => {
    const provider = make();
    const shipment = await provider.createTracking({
      trackingNumber: "FAKE-OFD-1",
    });
    const body = JSON.stringify({ trackings: [shipment] });

    const [parsed] = await provider.parseWebhook(body, bearer());
    expect(parsed).toEqual(shipment);
    expect(parsed?.eta).toBeInstanceOf(Date);
  });

  it("de-duplicates repeated events and sorts them newest first", async () => {
    const provider = make();
    const shipment = await provider.createTracking({
      trackingNumber: "FAKE-TRANSIT-1",
    });
    const [newest, ...rest] = shipment.events;
    const body = JSON.stringify({
      trackings: [{ ...shipment, events: [...rest, newest, newest] }],
    });

    const [parsed] = await provider.parseWebhook(body, bearer());
    expect(parsed?.events.map((e) => e.providerEventId)).toEqual(
      shipment.events.map((e) => e.providerEventId),
    );
  });

  it("rejects a wrong or missing secret", async () => {
    await expect(
      make().parseWebhook("{}", bearer("wrong")),
    ).rejects.toBeInstanceOf(WebhookAuthError);
    await expect(
      make().parseWebhook("{}", new Headers()),
    ).rejects.toBeInstanceOf(WebhookAuthError);
  });

  it("rejects a non-JSON or invalid body after authenticating", async () => {
    await expect(
      make().parseWebhook("not json", bearer()),
    ).rejects.toBeInstanceOf(ProviderResponseError);
    await expect(
      make().parseWebhook(JSON.stringify({ trackings: [{}] }), bearer()),
    ).rejects.toBeInstanceOf(ProviderResponseError);
  });
});
