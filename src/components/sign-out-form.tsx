"use client";

import { useRef } from "react";
import { forgetThisDevice } from "@/lib/pwa/device-cleanup";

interface SignOutFormProps {
  signOutAction: () => Promise<void>;
  /** Stops alerts to this device; optional so a page without it still works. */
  removeDeviceAction?: (endpoint: string) => Promise<void>;
}

/**
 * The Sign out button. Before the session ends it forgets this device (push
 * subscription and offline copy), because afterwards the server would no longer
 * know who is asking. If that clean-up fails or is slow, signing out goes ahead.
 */
export function SignOutForm({
  signOutAction,
  removeDeviceAction,
}: SignOutFormProps) {
  const cleanedUp = useRef(false);

  return (
    <form
      action={signOutAction}
      onSubmit={async (event) => {
        if (cleanedUp.current) return;
        // Hold the submit, tidy up, then submit again.
        event.preventDefault();
        const form = event.currentTarget;
        try {
          await forgetThisDevice({
            removeFromServer: removeDeviceAction ?? (async () => {}),
          });
        } catch {
          // Clean-up is best effort; signing out must still happen.
        }
        cleanedUp.current = true;
        form.requestSubmit();
      }}
    >
      <button
        type="submit"
        className="rounded-md px-3 py-1.5 text-sm hover:bg-slate-100"
      >
        Sign out
      </button>
    </form>
  );
}
