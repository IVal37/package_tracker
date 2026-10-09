"use client";

import { useEffect, useState } from "react";
import { currentPushEnvironment } from "@/lib/pwa/service-worker";

/** Chromium's install prompt event, which TypeScript's DOM types do not include. */
interface BeforeInstallPromptEvent extends Event {
  prompt(): Promise<void>;
}

type Mode = "hidden" | "chromium" | "ios";

/**
 * Offers to install Wayfind to the home screen. Chromium browsers get a button
 * (the browser decides when installing is possible); iPhone and iPad get the
 * Share steps, since Safari has no prompt. Nothing shows once installed.
 */
export function InstallCard() {
  const [mode, setMode] = useState<Mode>("hidden");
  const [prompt, setPrompt] = useState<BeforeInstallPromptEvent | null>(null);

  useEffect(() => {
    const env = currentPushEnvironment();
    if (env.isStandalone) return;
    // Reads the browser, so it can only run after mount.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    if (env.isIos) setMode("ios");

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
      aria-labelledby="install-heading"
      className="space-y-3 rounded-lg border border-slate-200 bg-white p-4"
    >
      <h3 id="install-heading" className="font-semibold">
        Install Wayfind
      </h3>
      {mode === "chromium" && prompt && (
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
      {mode === "ios" && (
        <p className="text-sm text-slate-600">
          To install on iPhone or iPad, tap the Share button in Safari, then
          choose <strong>Add to Home Screen</strong>. Push notifications work
          once Wayfind is installed.
        </p>
      )}
    </section>
  );
}
