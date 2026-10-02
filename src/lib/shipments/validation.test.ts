import { describe, expect, it } from "vitest";
import { addShipmentSchema, toFieldErrors } from "./validation";

const parse = (input: unknown) => addShipmentSchema.safeParse(input);

describe("addShipmentSchema: trackingNumber", () => {
  it.each([
    ["  9400 1159 0104 7177 5982 06 ", "9400115901047177598206"],
    ["1z999aa10123456784", "1Z999AA10123456784"],
    ["ab-12_3/4.5", "AB-12_3/4.5"],
    ["ABCDE", "ABCDE"],
  ])("normalizes %j to %j", (input, expected) => {
    const result = parse({ trackingNumber: input });
    expect(result.success && result.data.trackingNumber).toBe(expected);
  });

  it.each([
    ["", /at least 5/],
    ["    ", /at least 5/],
    ["ABCD", /at least 5/],
    ["A".repeat(51), /at most 50/],
    ["ABC#12345", /only letters/],
    ["12345 ünï", /only letters/],
  ])("rejects %j", (input, message) => {
    const result = parse({ trackingNumber: input });
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(toFieldErrors(result.error).trackingNumber).toMatch(message);
    }
  });

  it("accepts exactly 50 characters", () => {
    expect(parse({ trackingNumber: "A".repeat(50) }).success).toBe(true);
  });

  it("rejects a missing tracking number", () => {
    expect(parse({}).success).toBe(false);
  });
});

describe("addShipmentSchema: nickname", () => {
  it("is optional and becomes null", () => {
    const result = parse({ trackingNumber: "ABCDE12345" });
    expect(result.success && result.data.nickname).toBeNull();
  });

  it("trims, and an empty or blank nickname becomes null", () => {
    const named = parse({ trackingNumber: "ABCDE12345", nickname: "  Boots " });
    expect(named.success && named.data.nickname).toBe("Boots");

    const blank = parse({ trackingNumber: "ABCDE12345", nickname: "   " });
    expect(blank.success && blank.data.nickname).toBeNull();
  });

  it("rejects more than 60 characters", () => {
    const result = parse({
      trackingNumber: "ABCDE12345",
      nickname: "n".repeat(61),
    });
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(toFieldErrors(result.error).nickname).toMatch(/at most 60/);
    }
  });
});

describe("toFieldErrors", () => {
  it("keeps the first message per field and reports both fields", () => {
    const result = parse({ trackingNumber: "", nickname: "n".repeat(61) });
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(Object.keys(toFieldErrors(result.error)).sort()).toEqual([
        "nickname",
        "trackingNumber",
      ]);
    }
  });
});
