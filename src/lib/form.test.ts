import { describe, expect, it } from "vitest";
import { formText } from "./form";

describe("formText", () => {
  it("reads a field as text, or empty when it is missing", () => {
    const formData = new FormData();
    formData.set("name", "value");
    expect(formText(formData, "name")).toBe("value");
    expect(formText(formData, "other")).toBe("");
  });
});
