// @vitest-environment node
import { describe, expect, it } from "vitest";
import { ICONS } from "@/lib/pwa/icons";
import manifest from "./manifest";

describe("web app manifest", () => {
  const result = manifest();

  it("opens Wayfind like an app, at the list", () => {
    expect(result).toMatchObject({
      name: "Wayfind",
      short_name: "Wayfind",
      start_url: "/",
      scope: "/",
      display: "standalone",
    });
  });

  it("uses the brand colour for the title bar", () => {
    expect(result.theme_color).toBe("#2563eb");
    expect(result.background_color).toBeTruthy();
  });

  it("lists 192 and 512 icons and a maskable 512, each of which the app serves", () => {
    const icons = result.icons ?? [];
    expect(icons.map((i) => [i.sizes, i.purpose ?? "any"])).toEqual([
      ["192x192", "any"],
      ["512x512", "any"],
      ["512x512", "maskable"],
    ]);
    for (const icon of icons) {
      expect(icon.type).toBe("image/png");
      const file = icon.src.replace("/icons/", "");
      expect(icon.src.startsWith("/icons/")).toBe(true);
      expect(Object.keys(ICONS)).toContain(file);
      const size = Number(icon.sizes?.split("x")[0]);
      expect(ICONS[file]?.size).toBe(size);
    }
  });

  it("has nothing personal in it, because browsers fetch it without cookies", () => {
    expect(JSON.stringify(result)).not.toMatch(/@|token|secret|user/i);
  });
});
