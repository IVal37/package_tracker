import { globSync, readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const css = readFileSync("src/app/globals.css", "utf8");

/** The declarations inside the first block whose selector contains `selector`. */
function declarations(selector: string): Map<string, string> {
  const start = css.indexOf(selector);
  expect(start, `${selector} not found in globals.css`).toBeGreaterThan(-1);
  const open = css.indexOf("{", start);
  const close = css.indexOf("}", open);
  const found = new Map<string, string>();
  for (const line of css.slice(open + 1, close).split(";")) {
    const [name, value] = line.split(":").map((part) => part.trim());
    if (name?.startsWith("--") || name === "color-scheme") {
      found.set(name, value ?? "");
    }
  }
  return found;
}

const pinned = declarations(':root[data-theme="dark"]');
const followsDevice = declarations(':root:not([data-theme="light"])');

describe("dark theme tokens", () => {
  it("are identical for 'Dark' and for 'Match device' on a dark device", () => {
    expect([...followsDevice]).toEqual([...pinned]);
    expect(pinned.size).toBeGreaterThan(20);
  });

  it("is wrapped in the prefers-color-scheme media query", () => {
    const media = css.indexOf("@media (prefers-color-scheme: dark)");
    expect(media).toBeGreaterThan(-1);
    expect(css.indexOf(':root:not([data-theme="light"])')).toBeGreaterThan(
      media,
    );
  });
});

// Shades that are the same in both themes: filled buttons with white text.
const SAME_IN_BOTH_THEMES = new Set([
  "brand-600",
  "brand-700",
  "red-600",
  "red-700",
]);

const COLOR_CLASS =
  /\b(?:[a-z-]+:)*(?:bg|text|border|divide|ring|outline|fill|stroke|from|to|via)-([a-z]+-\d{2,3})\b/g;

const sources = globSync("src/**/*.tsx").filter(
  (file) => !/\.test\.tsx$/.test(file.replaceAll("\\", "/")),
);

describe("colours used by components", () => {
  it("each has a dark value, or is deliberately the same in both themes", () => {
    const missing: string[] = [];
    for (const file of sources) {
      const text = readFileSync(file, "utf8");
      for (const match of text.matchAll(COLOR_CLASS)) {
        const shade = match[1]!;
        if (SAME_IN_BOTH_THEMES.has(shade)) continue;
        if (!pinned.has(`--color-${shade}`)) missing.push(`${file}: ${shade}`);
      }
    }
    expect([...new Set(missing)]).toEqual([]);
  });

  it("use the theme tokens where one shade would mean two things", () => {
    const wrong: string[] = [];
    for (const file of sources) {
      const text = readFileSync(file, "utf8");
      for (const bad of [
        /\bbg-white\b/,
        /\btext-brand-700\b/,
        /\btext-red-[67]00\b/,
        /\bbg-slate-900\b/,
      ]) {
        if (bad.test(text)) wrong.push(`${file}: ${bad.source}`);
      }
    }
    expect(wrong).toEqual([]);
  });
});

/** The declarations of the first `:root:root` block after `marker`. */
function declarationsAfter(marker: string): Map<string, string> {
  const at = css.indexOf(marker);
  expect(at, `${marker} not found in globals.css`).toBeGreaterThan(-1);
  const open = css.indexOf("{", css.indexOf(":root:root", at));
  const found = new Map<string, string>();
  for (const line of css.slice(open + 1, css.indexOf("}", open)).split(";")) {
    const [name, value] = line.split(":").map((part) => part.trim());
    if (name?.startsWith("--")) found.set(name, value ?? "");
  }
  return found;
}

describe("liquid glass", () => {
  it("has a dark value for every glass token", () => {
    const tokens = [...css.matchAll(/^ {2}(--(?:glass|wash)-[a-z-]+):/gm)].map(
      (match) => match[1]!,
    );
    const colours = tokens.filter((name) => !name.startsWith("--glass-blur"));
    for (const name of new Set(colours)) {
      expect(pinned.has(name), `${name} has no dark value`).toBe(true);
    }
  });

  it("falls back to solid in the same way when blur is unsupported or unwanted", () => {
    const unsupported = declarationsAfter("@supports not");
    const unwanted = declarationsAfter("@media (prefers-reduced-transparency");
    expect(unsupported.size).toBeGreaterThan(4);
    expect([...unwanted]).toEqual([...unsupported]);
  });

  it("draws cards as glass, not as flat bordered boxes", () => {
    const flat = sources.filter((file) =>
      /rounded-(?:md|lg) border border-slate-d+ bg-surface/.test(
        readFileSync(file, "utf8"),
      ),
    );
    expect(flat).toEqual([]);
  });

  it("never blurs an element itself, only its ::before layer", () => {
    // A backdrop filter on an element makes it the containing block of its
    // fixed children, which traps the Upgrade popup inside the header.
    const offenders = sources.filter((file) =>
      /\bbackdrop-|backdrop-?[fF]ilter/.test(readFileSync(file, "utf8")),
    );
    expect(offenders).toEqual([]);
  });
});
