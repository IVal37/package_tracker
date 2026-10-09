// The app icons, drawn in code so there are no image files to keep in step.
// ImageResponse turns this markup into a PNG. Brand colours match globals.css.
import type { ReactElement } from "react";

export const BRAND_COLOR = "#2563eb";
const WHITE = "#ffffff";

export interface IconSpec {
  size: number;
  /**
   * Maskable icons fill the whole square and keep the mark inside the middle 60%,
   * because the OS crops them to its own shape. Others have rounded corners.
   */
  maskable: boolean;
}

/** Every icon the app serves, by file name under /icons/. */
export const ICONS: Readonly<Record<string, IconSpec>> = {
  "icon-192.png": { size: 192, maskable: false },
  "icon-512.png": { size: 512, maskable: false },
  "maskable-512.png": { size: 512, maskable: true },
  "apple-touch-icon.png": { size: 180, maskable: false },
};

/** The spec for a file name, or null. Own properties only: "__proto__" is not an icon. */
export function iconSpec(file: string): IconSpec | null {
  return Object.hasOwn(ICONS, file) ? (ICONS[file] ?? null) : null;
}

/** A map pin: the Wayfind mark. */
export function iconElement({ size, maskable }: IconSpec): ReactElement {
  const mark = Math.round(size * (maskable ? 0.5 : 0.62));
  return (
    <div
      style={{
        width: size,
        height: size,
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        background: BRAND_COLOR,
        borderRadius: maskable ? 0 : Math.round(size * 0.22),
      }}
    >
      <svg width={mark} height={mark} viewBox="0 0 24 24">
        <path
          d="M12 2C8.1 2 5 5.1 5 9c0 5.2 7 13 7 13s7-7.8 7-13c0-3.9-3.1-7-7-7z"
          fill={WHITE}
        />
        <circle cx="12" cy="9" r="2.8" fill={BRAND_COLOR} />
      </svg>
    </div>
  );
}
