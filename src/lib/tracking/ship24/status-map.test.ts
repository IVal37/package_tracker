import { describe, expect, it } from "vitest";
import { STATUSES, type Status } from "../status";
import {
  SHIP24_MILESTONES,
  SHIP24_MILESTONE_TO_STATUS,
  mapShip24Status,
} from "./status-map";

describe("mapShip24Status: milestones", () => {
  it.each([
    ["pending", "Pending"],
    ["info_received", "InfoReceived"],
    ["in_transit", "InTransit"],
    ["out_for_delivery", "OutForDelivery"],
    ["failed_attempt", "AttemptFail"],
    ["available_for_pickup", "AvailableForPickup"],
    ["delivered", "Delivered"],
    ["exception", "Exception"],
  ] satisfies [string, Status][])("%s -> %s", (milestone, expected) => {
    expect(mapShip24Status(milestone)).toBe(expected);
  });

  it("covers every documented milestone", () => {
    expect(Object.keys(SHIP24_MILESTONE_TO_STATUS).sort()).toEqual(
      [...SHIP24_MILESTONES].sort(),
    );
  });

  it("falls back to Pending for an unknown milestone", () => {
    expect(mapShip24Status("something_new")).toBe("Pending");
    expect(mapShip24Status("")).toBe("Pending");
    expect(mapShip24Status("toString")).toBe("Pending");
  });

  it("only ever returns a valid internal Status, and never Expired", () => {
    for (const milestone of [...SHIP24_MILESTONES, "unknown"]) {
      const status = mapShip24Status(milestone);
      expect(STATUSES).toContain(status);
      expect(status).not.toBe("Expired");
    }
  });
});

// Every documented statusCode (docs.ship24.com/status), with the milestone
// Ship24 typically reports alongside it.
describe("mapShip24Status: documented statusCodes", () => {
  it.each([
    ["data_order_created", "info_received", "InfoReceived"],
    ["data_order_cancelled", "info_received", "Exception"],
    ["data_delivery_proposed", "info_received", "InfoReceived"],
    ["data_delivery_decided", "info_received", "InfoReceived"],
    ["transit_handover", "in_transit", "InTransit"],
    ["transit_origin_country_departure", "in_transit", "InTransit"],
    ["destination_arrival", "in_transit", "InTransit"],
    ["customs_received", "in_transit", "InTransit"],
    ["customs_exception", "in_transit", "InTransit"],
    ["customs_rejected", "in_transit", "InTransit"],
    ["customs_cleared", "in_transit", "InTransit"],
    [
      "delivery_available_for_pickup",
      "available_for_pickup",
      "AvailableForPickup",
    ],
    ["delivery_out_for_delivery", "out_for_delivery", "OutForDelivery"],
    ["delivery_attempted", "failed_attempt", "AttemptFail"],
    ["delivery_exception", "exception", "Exception"],
    ["delivery_refused", "exception", "Exception"],
    ["delivery_delivered", "delivered", "Delivered"],
    ["exception_return", "exception", "Exception"],
    ["exception_lost", "exception", "Exception"],
    ["exception_discarded", "exception", "Exception"],
  ] satisfies [string, string, Status][])(
    "%s (milestone %s) -> %s",
    (statusCode, milestone, expected) => {
      expect(mapShip24Status(milestone, statusCode)).toBe(expected);
    },
  );

  it("forces Exception for any exception_* code, whatever the milestone", () => {
    expect(mapShip24Status("in_transit", "exception_lost")).toBe("Exception");
  });

  it("ignores a null or unknown statusCode", () => {
    expect(mapShip24Status("delivered", null)).toBe("Delivered");
    expect(mapShip24Status("delivered", "brand_new_code")).toBe("Delivered");
  });
});
