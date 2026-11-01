import { describe, expect, it } from "vitest";
import { errorName } from "./errors";

describe("errorName", () => {
  it("gives the class name and never the message", () => {
    expect(errorName(new TypeError("secret detail"))).toBe("TypeError");
  });

  it("falls back for anything that is not an Error", () => {
    expect(errorName("a string")).toBe("unknown");
    expect(errorName(null, "unknown error")).toBe("unknown error");
  });
});
