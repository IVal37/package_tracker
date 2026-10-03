import { describe, expect, it } from "vitest";
import { ADD_PACKAGE_MESSAGES, toAddPackageState } from "./form-state";

const values = { trackingNumber: "ABC12345", nickname: "Boots" };

describe("toAddPackageState", () => {
  it("maps success", () => {
    expect(toAddPackageState({ ok: true, shipmentId: "id" }, values)).toEqual({
      status: "success",
    });
  });

  it("keeps field errors and the typed values for invalid input", () => {
    const state = toAddPackageState(
      {
        ok: false,
        error: "invalid",
        fieldErrors: { trackingNumber: "Too short" },
      },
      values,
    );
    expect(state).toEqual({
      status: "error",
      error: "invalid",
      fieldErrors: { trackingNumber: "Too short" },
      values,
    });
  });

  it.each(["duplicate", "not_found", "unavailable"] as const)(
    "maps %s with no field errors",
    (error) => {
      expect(toAddPackageState({ ok: false, error }, values)).toEqual({
        status: "error",
        error,
        fieldErrors: {},
        values,
      });
    },
  );

  it("has a message for every non-field error", () => {
    expect(Object.keys(ADD_PACKAGE_MESSAGES).sort()).toEqual([
      "duplicate",
      "not_found",
      "unavailable",
    ]);
  });
});
