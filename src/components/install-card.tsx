"use client";

import { useEffect, useState } from "react";
import { currentPushEnvironment } from "@/lib/pwa/service-worker";

/** Chromium's install prompt event, which TypeScript's DOM types do not include. */
interface BeforeInstallPromptEvent extends Event {
  prompt(): Promise<void>;
}

type Mode = "hidden" | "chromium";

/**
 * A one-click Install button, shown on Setup when the browser offers one
 * (Chromium decides when installing is possible). Safari has no prompt; its
 * steps are written out on Setup instead. Nothing shows once installed.
 */
export function InstallCard() {
  const [mode, setMode] = useState<Mode>("hidden");
  const [prompt, setPrompt] = useState<BeforeInstallPromptEvent | null>(null);

  useEffect(() => {
    // Reads the browser, so it can only run after mount.
    if (currentPushEnvironment().isStandalone) return;

    const onPrompt = (event: Event) => {
      event.preventDefault();
      setPrompt(event as BeforeInstallPromptEvent);
      setMode("chromium");
    };
    const onInstalled = () => {
      setPrompt(null);
      setMode("hidden");
    };
    window.addEventListener("beforeinstallprompt", onPrompt);
    window.addEventListener("appinstalled", onInstalled);
    return () => {
      window.removeEventListener("beforeinstallprompt", onPrompt);
      window.removeEventListener("appinstalled", onInstalled);
    };
  }, []);

  if (mode === "hidden") return null;

  return (
    <section
      aria-label="Install Wayfind"
      className="space-y-3 rounded-lg border border-slate-200 bg-surface p-4"
    >
      {prompt && (
        <>
          <p className="text-sm text-slate-600">
            Add Wayfind to your home screen or desktop. It opens like an app and
            shows your last list even when you are offline.
          </p>
          <button
            type="button"
            onClick={async () => {
              await prompt.prompt();
              setPrompt(null);
              setMode("hidden");
            }}
            className="rounded-md bg-brand-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-brand-700"
          >
            Install app
          </button>
        </>
      )}
    </section>
  );
}
