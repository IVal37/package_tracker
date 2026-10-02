import { describe, expect, it } from "vitest";
import { MODES, STATUSES } from "./status";

describe("status constants", () => {
  it("lists the 9 internal statuses from CLAUDE.md", () => {
    expect([...STATUSES]).toEqual([
      "Pending",
      "InfoReceived",
      "InTransit",
      "OutForDelivery",
      "AttemptFail",
      "Delivered",
      "AvailableForPickup",
      "Exception",
      "Expired",
    ]);
  });

  it("lists the 5 transport modes", () => {
    expect([...MODES]).toEqual(["truck", "plane", "ship", "van", "pin"]);
  });
});
