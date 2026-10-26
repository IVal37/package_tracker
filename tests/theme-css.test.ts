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
