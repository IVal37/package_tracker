// @vitest-environment node
import { isValidElement } from "react";
import { describe, expect, it } from "vitest";
import { BRAND_COLOR, ICONS, iconElement, iconSpec } from "./icons";

describe("iconSpec", () => {
  it("finds each known icon", () => {
    for (const file of Object.keys(ICONS)) {
      expect(iconSpec(file)).toEqual(ICONS[file]);
    }
  });

  it.each([
    "nope.png",
    "",
    "__proto__",
    "constructor",
    "hasOwnProperty",
    "ICON-192.PNG",
  ])("does not find %j", (file) => {
    expect(iconSpec(file)).toBeNull();
  });
});

describe("ICONS", () => {
  it("includes the sizes the manifest and Apple need", () => {
    expect(ICONS["icon-192.png"]).toEqual({ size: 192, maskable: false });
    expect(ICONS["icon-512.png"]).toEqual({ size: 512, maskable: false });
    expect(ICONS["maskable-512.png"]).toEqual({ size: 512, maskable: true });
    expect(ICONS["apple-touch-icon.png"]).toEqual({
      size: 180,
      maskable: false,
    });
  });
});

describe("iconElement", () => {
  const styleOf = (element: ReturnType<typeof iconElement>) =>
    (element.props as { style: Record<string, unknown> }).style;

  it("draws the brand colour at the requested size", () => {
    const element = iconElement({ size: 192, maskable: false });
    expect(isValidElement(element)).toBe(true);
    expect(styleOf(element)).toMatchObject({
      width: 192,
      height: 192,
      background: BRAND_COLOR,
    });
  });

  it("rounds the corners of a normal icon but fills the square of a maskable one", () => {
    expect(
      styleOf(iconElement({ size: 100, maskable: false })).borderRadius,
    ).toBe(22);
    expect(
      styleOf(iconElement({ size: 100, maskable: true })).borderRadius,
    ).toBe(0);
  });

  it("keeps the mark of a maskable icon smaller, inside the safe zone", () => {
    const markSize = (maskable: boolean) => {
      const element = iconElement({ size: 512, maskable });
      const svg = (element.props as { children: { props: { width: number } } })
        .children;
      return svg.props.width;
    };
    expect(markSize(true)).toBeLessThan(markSize(false));
    // The OS may crop a maskable icon to a circle of 80% of its width.
    expect(markSize(true)).toBeLessThanOrEqual(512 * 0.6);
  });
});
