"use client";

import { useEffect, useState } from "react";
import {
  applyThemeChoice,
  browserStorage,
  readStoredTheme,
  storeTheme,
  type ThemeChoice,
} from "@/lib/theme";

const OPTIONS: { value: ThemeChoice; label: string; hint: string }[] = [
  {
    value: "system",
    label: "Match device",
    hint: "Light or dark, as this device is set",
  },
  { value: "light", label: "Light", hint: "Always light" },
  { value: "dark", label: "Dark", hint: "Always dark" },
];

/** Light, dark, or follow the device. Saved in this browser only. */
export function ThemeSwitcher() {
  const [choice, setChoice] = useState<ThemeChoice>("system");

  useEffect(() => {
    // Reads the browser, so it can only run after mount.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setChoice(readStoredTheme(browserStorage()));
  }, []);

  const choose = (next: ThemeChoice) => {
    setChoice(next);
    applyThemeChoice(document.documentElement, next);
    storeTheme(browserStorage(), next);
  };

  return (
    <section
      aria-labelledby="theme-heading"
      className="space-y-3 rounded-lg border border-slate-200 bg-surface p-4"
    >
      <h3 id="theme-heading" className="font-semibold">
        Theme
      </h3>
      <fieldset className="space-y-2">
        <legend className="sr-only">Theme</legend>
        {OPTIONS.map((option) => (
          <label key={option.value} className="flex items-start gap-2 text-sm">
            <input
              type="radio"
              name="theme"
              value={option.value}
              checked={choice === option.value}
              onChange={() => choose(option.value)}
              className="mt-0.5"
            />
            <span>
              <span className="font-medium">{option.label}</span>
              <span className="block text-slate-600">{option.hint}</span>
            </span>
          </label>
        ))}
      </fieldset>
      <p className="text-sm text-slate-500">Saved on this device.</p>
    </section>
  );
}
