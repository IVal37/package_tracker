"use client";

import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";

export const POLL_EVERY_MS = 5_000;
/** Long enough to switch to Gmail, add the address and wait for its email. */
export const POLL_FOR_MS = 3 * 60_000;

/**
 * Shown on Setup while there is no Gmail confirmation code yet. The page is
 * drawn on the server, so this asks it to draw again every few seconds; once
 * the code exists the page no longer renders this and the checking stops by
 * itself. It also stops after a few minutes, so a Setup page left open does not
 * keep the server busy.
 */
export function ConfirmationWatcher() {
  const router = useRouter();
  const [round, setRound] = useState(0);
  const [waiting, setWaiting] = useState(true);

  useEffect(() => {
    const started = Date.now();
    const timer = setInterval(() => {
      if (Date.now() - started >= POLL_FOR_MS) {
        clearInterval(timer);
        setWaiting(false);
        return;
      }
      // A hidden tab has nobody to show the code to.
      if (document.visibilityState === "visible") router.refresh();
    }, POLL_EVERY_MS);
    return () => clearInterval(timer);
  }, [round, router]);

  const checkNow = () => {
    router.refresh();
    setWaiting(true);
    setRound((current) => current + 1);
  };

  return (
    <div
      role="status"
      className="flex flex-wrap items-center gap-3 text-sm text-slate-600"
    >
      <span>
        {waiting
          ? "Using Gmail? Its confirmation link or code appears here by itself."
          : "No Gmail confirmation yet."}
      </span>
      <button
        type="button"
        onClick={checkNow}
        className="rounded border border-slate-300 bg-surface px-2 py-1 text-slate-700 hover:bg-slate-100"
      >
        Check now
      </button>
    </div>
  );
}
