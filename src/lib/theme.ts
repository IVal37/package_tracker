// Light / dark appearance. The choice lives in the browser (localStorage), per
// device, and is applied as `data-theme` on <html>. With no attribute, the
// stylesheet follows the device's own setting (prefers-color-scheme).
// Safe to import in client components (no Node, no server code).

export type ThemeChoice = "system" | "light" | "dark";
export type ResolvedTheme = "light" | "dark";

export const THEME_STORAGE_KEY = "wayfind-theme";
export const THEME_ATTRIBUTE = "data-theme";

/** Anything that is not a known choice means "follow the device". */
export function parseThemeChoice(raw: unknown): ThemeChoice {
  return raw === "light" || raw === "dark" ? raw : "system";
}

interface AttributeTarget {
  setAttribute(name: string, value: string): void;
  removeAttribute(name: string): void;
}

/** Light and dark pin the theme; system removes the pin. */
export function applyThemeChoice(
  root: AttributeTarget,
  choice: ThemeChoice,
): void {
  if (choice === "system") root.removeAttribute(THEME_ATTRIBUTE);
  else root.setAttribute(THEME_ATTRIBUTE, choice);
}

/** The theme actually showing, for things CSS cannot reach (the map). */
export function resolvedTheme(
  root: { getAttribute(name: string): string | null },
  prefersDark: boolean,
): ResolvedTheme {
  const pinned = parseThemeChoice(root.getAttribute(THEME_ATTRIBUTE));
  if (pinned !== "system") return pinned;
  return prefersDark ? "dark" : "light";
}

interface StorageLike {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
}

/** Storage can be missing or throw (private windows, blocked site data). */
export function readStoredTheme(storage: StorageLike | undefined): ThemeChoice {
  try {
    return parseThemeChoice(storage?.getItem(THEME_STORAGE_KEY));
  } catch {
    return "system";
  }
}

export function storeTheme(
  storage: StorageLike | undefined,
  choice: ThemeChoice,
): void {
  try {
    if (choice === "system") storage?.removeItem(THEME_STORAGE_KEY);
    else storage?.setItem(THEME_STORAGE_KEY, choice);
  } catch {
    // The choice still applies for this visit; it just is not remembered.
  }
}

/**
 * Runs in <head> before the first paint, so a saved choice never flashes the
 * other theme. A fixed string with no user data in it.
 */
export const THEME_BOOT_SCRIPT = `try{var t=localStorage.getItem(${JSON.stringify(
  THEME_STORAGE_KEY,
)});if(t==="light"||t==="dark")document.documentElement.setAttribute(${JSON.stringify(
  THEME_ATTRIBUTE,
)},t)}catch(e){}`;

/** The browser's localStorage, or undefined where even reading it throws. */
export function browserStorage(): StorageLike | undefined {
  try {
    return window.localStorage;
  } catch {
    return undefined;
  }
}
