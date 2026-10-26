// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  THEME_BOOT_SCRIPT,
  THEME_STORAGE_KEY,
  applyThemeChoice,
  parseThemeChoice,
  readStoredTheme,
  resolvedTheme,
  storeTheme,
} from "./theme";

afterEach(() => {
  localStorage.clear();
  document.documentElement.removeAttribute("data-theme");
  vi.restoreAllMocks();
});

describe("parseThemeChoice", () => {
  it("keeps light and dark and turns everything else into system", () => {
    expect(parseThemeChoice("light")).toBe("light");
    expect(parseThemeChoice("dark")).toBe("dark");
    for (const junk of ["system", "", "Dark", "<script>", null, undefined, 3]) {
      expect(parseThemeChoice(junk)).toBe("system");
    }
  });
});

describe("applyThemeChoice", () => {
  it("pins light and dark, and removes the pin for system", () => {
    const root = document.documentElement;
    applyThemeChoice(root, "dark");
    expect(root.getAttribute("data-theme")).toBe("dark");
    applyThemeChoice(root, "light");
    expect(root.getAttribute("data-theme")).toBe("light");
    applyThemeChoice(root, "system");
    expect(root.hasAttribute("data-theme")).toBe(false);
  });
});

describe("resolvedTheme", () => {
  const root = document.documentElement;

  it("follows the device when nothing is pinned", () => {
    expect(resolvedTheme(root, true)).toBe("dark");
    expect(resolvedTheme(root, false)).toBe("light");
  });

  it("prefers the pinned choice over the device", () => {
    applyThemeChoice(root, "light");
    expect(resolvedTheme(root, true)).toBe("light");
    applyThemeChoice(root, "dark");
    expect(resolvedTheme(root, false)).toBe("dark");
  });
});

describe("readStoredTheme and storeTheme", () => {
  it("round-trips light and dark, and forgets on system", () => {
    storeTheme(localStorage, "dark");
    expect(localStorage.getItem(THEME_STORAGE_KEY)).toBe("dark");
    expect(readStoredTheme(localStorage)).toBe("dark");
    storeTheme(localStorage, "system");
    expect(localStorage.getItem(THEME_STORAGE_KEY)).toBeNull();
    expect(readStoredTheme(localStorage)).toBe("system");
  });

  it("copes with missing or throwing storage", () => {
    const broken = {
      getItem: () => {
        throw new Error("blocked");
      },
      setItem: () => {
        throw new Error("blocked");
      },
      removeItem: () => {
        throw new Error("blocked");
      },
    };
    expect(readStoredTheme(broken)).toBe("system");
    expect(readStoredTheme(undefined)).toBe("system");
    expect(() => storeTheme(broken, "dark")).not.toThrow();
    expect(() => storeTheme(broken, "system")).not.toThrow();
    expect(() => storeTheme(undefined, "dark")).not.toThrow();
  });
});

describe("THEME_BOOT_SCRIPT", () => {
  const run = () => new Function(THEME_BOOT_SCRIPT)();
  const pinned = () => document.documentElement.getAttribute("data-theme");

  it("pins a saved light or dark choice", () => {
    localStorage.setItem(THEME_STORAGE_KEY, "dark");
    run();
    expect(pinned()).toBe("dark");
    localStorage.setItem(THEME_STORAGE_KEY, "light");
    run();
    expect(pinned()).toBe("light");
  });

  it("pins nothing when nothing is saved or the value is junk", () => {
    run();
    expect(pinned()).toBeNull();
    localStorage.setItem(THEME_STORAGE_KEY, "javascript:alert(1)");
    run();
    expect(pinned()).toBeNull();
  });

  it("does not throw when storage does", () => {
    vi.spyOn(Storage.prototype, "getItem").mockImplementation(() => {
      throw new Error("blocked");
    });
    expect(run).not.toThrow();
    expect(pinned()).toBeNull();
  });
});
