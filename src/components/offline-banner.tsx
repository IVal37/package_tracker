"use client";

import { useSyncExternalStore } from "react";

function subscribe(onChange: () => void) {
  window.addEventListener("online", onChange);
  window.addEventListener("offline", onChange);
  return () => {
    window.removeEventListener("online", onChange);
    window.removeEventListener("offline", onChange);
  };
}

const isOffline = () => !navigator.onLine;
// The server cannot know; the page is assumed online until the browser says not.
const serverSnapshot = () => false;

interface OfflineBannerProps {
  /** When the server drew this page (ISO). A copy shown offline is from then. */
  renderedAt: string;
}

/** Tells the user, only while offline, that the list may be out of date. */
export function OfflineBanner({ renderedAt }: OfflineBannerProps) {
  const offline = useSyncExternalStore(subscribe, isOffline, serverSnapshot);
  if (!offline) return null;

  const when = new Date(renderedAt);
  const shown = Number.isNaN(when.getTime())
    ? null
    : new Intl.DateTimeFormat(undefined, {
        dateStyle: "medium",
        timeStyle: "short",
      }).format(when);

  return (
    <p
      role="status"
      className="rounded-lg border border-amber-300 bg-amber-50 p-3 text-sm"
    >
      You&apos;re offline.{" "}
      {shown
        ? `Showing your list as it was on ${shown}.`
        : "Showing a saved copy of your list."}
    </p>
  );
}
