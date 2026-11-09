import { describe, expect, it } from "vitest";
import { ORDER_STAGES, shouldSetStage, stageForEmailType } from "./order-stage";

describe("stageForEmailType", () => {
  it("maps each email kind to its stage", () => {
    expect(stageForEmailType("order_confirmation")).toBe("ordered");
    expect(stageForEmailType("shipping_confirmation")).toBe("shipped");
    expect(stageForEmailType("delivery_update")).toBe("delivered");
  });

  it("gives no stage to anything else", () => {
    expect(stageForEmailType("other")).toBeNull();
    expect(stageForEmailType("")).toBeNull();
  });

  it("only ever returns a stage the database accepts", () => {
    for (const kind of [
      "order_confirmation",
      "shipping_confirmation",
      "delivery_update",
    ]) {
      expect(ORDER_STAGES).toContain(stageForEmailType(kind));
    }
  });
});

describe("shouldSetStage", () => {
  const noon = new Date("2026-11-07T12:00:00Z");

  it("accepts the first email", () => {
    expect(shouldSetStage({ stageAt: null }, noon)).toBe(true);
  });

  it("accepts a newer email", () => {
    expect(
      shouldSetStage({ stageAt: noon }, new Date("2026-11-07T12:00:01Z")),
    ).toBe(true);
  });

  it("ignores an older email that arrived late", () => {
    expect(
      shouldSetStage({ stageAt: noon }, new Date("2026-11-07T11:59:59Z")),
    ).toBe(false);
  });

  it("ignores a repeat of the same moment", () => {
    expect(shouldSetStage({ stageAt: noon }, new Date(noon))).toBe(false);
  });
});
