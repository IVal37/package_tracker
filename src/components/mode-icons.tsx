import type { Mode } from "@/lib/tracking";

// One source of truth for the five transport icons. The React <ModeIcon> and
// the images the map registers (via modeIconSvg) both draw from MODE_GLYPHS, so
// the page and the map can never disagree about which icon means what.

/** 24x24 glyphs, filled, drawn with the even-odd rule. */
const MODE_GLYPHS: Record<Mode, string[]> = {
  truck: [
    "M2 6h12v9H2z",
    "M14 9h4l3.5 3.5V15H14z",
    "M5 17.5a2 2 0 1 0 4 0a2 2 0 1 0-4 0z",
    "M15 17.5a2 2 0 1 0 4 0a2 2 0 1 0-4 0z",
  ],
  van: [
    "M2 8h10l5 4h4.5v3H2z",
    "M5 17.5a2 2 0 1 0 4 0a2 2 0 1 0-4 0z",
    "M15 17.5a2 2 0 1 0 4 0a2 2 0 1 0-4 0z",
  ],
  plane: [
    "M12 2l2.2 7.3L22 13v2l-7.8-1.3L13.5 19l2.5 1.5V22l-4-1-4 1v-1.5l2.5-1.5-.7-5.3L2 15v-2l7.8-3.7z",
  ],
  ship: ["M3 15h18l-2.5 5h-13z", "M7 9h10v5H7z", "M11 4h2v4h-2z"],
  pin: [
    "M12 2a7 7 0 0 0-7 7c0 5 7 13 7 13s7-8 7-13a7 7 0 0 0-7-7zm0 9.5a2.5 2.5 0 1 1 0-5 2.5 2.5 0 0 1 0 5z",
  ],
};

export const MODE_LABELS: Record<Mode, string> = {
  truck: "Truck",
  van: "Delivery van",
  plane: "Plane",
  ship: "Ship",
  pin: "Not moving",
};

/** Badge colour behind each glyph on the map. */
export const MODE_COLORS: Record<Mode, string> = {
  truck: "#1d4ed8",
  van: "#15803d",
  plane: "#7c3aed",
  ship: "#0e7490",
  pin: "#b91c1c",
};

interface ModeIconProps {
  mode: Mode;
  className?: string;
}

/** Inline icon in the current text colour, titled for screen readers. */
export function ModeIcon({ mode, className }: ModeIconProps) {
  return (
    <svg
      data-mode={mode}
      viewBox="0 0 24 24"
      width="1.25em"
      height="1.25em"
      fill="currentColor"
      fillRule="evenodd"
      role="img"
      aria-label={MODE_LABELS[mode]}
      className={className}
    >
      <title>{MODE_LABELS[mode]}</title>
      {MODE_GLYPHS[mode].map((d) => (
        <path key={d} d={d} />
      ))}
    </svg>
  );
}

/**
 * A standalone SVG document for the map: the glyph in white on a coloured round
 * badge. The map turns this into an image per mode.
 */
export function modeIconSvg(mode: Mode, size = 48): string {
  const paths = MODE_GLYPHS[mode].map((d) => `<path d="${d}"/>`).join("");
  return (
    `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 24 24">` +
    `<circle cx="12" cy="12" r="11.25" fill="${MODE_COLORS[mode]}" stroke="#ffffff" stroke-width="1.5"/>` +
    `<g transform="translate(5 5) scale(0.5833)" fill="#ffffff" fill-rule="evenodd">${paths}</g>` +
    `</svg>`
  );
}
