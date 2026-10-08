import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { MODES, type Mode } from "@/lib/tracking/status";
import { MODE_COLORS, MODE_LABELS, ModeIcon, modeIconSvg } from "./mode-icons";

const EXPECTED_LABELS: Record<Mode, string> = {
  truck: "Truck",
  van: "Delivery van",
  plane: "Plane",
  ship: "Ship",
  pin: "Not moving",
};

describe("ModeIcon", () => {
  it.each(MODES)("renders the %s icon, labelled for screen readers", (mode) => {
    render(<ModeIcon mode={mode} />);
    const icon = screen.getByRole("img", { name: EXPECTED_LABELS[mode] });
    expect(icon).toHaveAttribute("data-mode", mode);
    expect(icon.querySelector("title")?.textContent).toBe(
      EXPECTED_LABELS[mode],
    );
    expect(icon.querySelectorAll("path").length).toBeGreaterThan(0);
  });

  it("draws a different glyph for every mode", () => {
    const glyphs = MODES.map((mode) => {
      const { container, unmount } = render(<ModeIcon mode={mode} />);
      const d = [...container.querySelectorAll("path")]
        .map((p) => p.getAttribute("d"))
        .join("|");
      unmount();
      return d;
    });
    expect(new Set(glyphs).size).toBe(MODES.length);
  });

  it("takes its colour from the surrounding text", () => {
    render(<ModeIcon mode="truck" className="text-slate-500" />);
    const icon = screen.getByRole("img", { name: "Truck" });
    expect(icon).toHaveAttribute("fill", "currentColor");
    expect(icon).toHaveClass("text-slate-500");
  });

  it("has a label for every mode", () => {
    expect(Object.keys(MODE_LABELS).sort()).toEqual([...MODES].sort());
    expect(MODE_LABELS).toEqual(EXPECTED_LABELS);
  });
});

describe("modeIconSvg (the images the map registers)", () => {
  it.each(MODES)("builds a self-contained SVG for %s", (mode) => {
    const svg = modeIconSvg(mode, 64);
    const doc = new DOMParser().parseFromString(svg, "image/svg+xml");

    expect(doc.querySelector("parsererror")).toBeNull();
    expect(doc.documentElement.getAttribute("xmlns")).toBe(
      "http://www.w3.org/2000/svg",
    );
    expect(doc.documentElement.getAttribute("width")).toBe("64");
    expect(svg).toContain(MODE_COLORS[mode]);
  });

  it("uses the same glyph paths as the inline icon", () => {
    for (const mode of MODES) {
      const { container, unmount } = render(<ModeIcon mode={mode} />);
      const inline = [...container.querySelectorAll("path")].map((p) =>
        p.getAttribute("d"),
      );
      unmount();
      for (const d of inline) expect(modeIconSvg(mode)).toContain(`d="${d}"`);
    }
  });

  it("gives every mode its own colour, so they can be told apart at a glance", () => {
    expect(new Set(Object.values(MODE_COLORS)).size).toBe(MODES.length);
  });
});
