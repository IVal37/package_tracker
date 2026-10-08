"use client";

import { useState } from "react";

interface RegenerateAddressProps {
  action: (formData: FormData) => Promise<void>;
}

/** Replaces the forwarding address. Asks first, because the old one stops working at once. */
export function RegenerateAddress({ action }: RegenerateAddressProps) {
  const [confirming, setConfirming] = useState(false);

  return (
    <form action={action}>
      {confirming ? (
        <div className="flex flex-wrap items-center gap-3">
          <span className="text-sm">
            The old address will stop working immediately. Continue?
          </span>
          <button
            type="submit"
            className="rounded-md bg-red-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-red-700"
          >
            Yes, regenerate
          </button>
          <button
            type="button"
            onClick={() => setConfirming(false)}
            className="rounded-md px-3 py-1.5 text-sm hover:bg-slate-100"
          >
            Cancel
          </button>
        </div>
      ) : (
        <button
          type="button"
          onClick={() => setConfirming(true)}
          className="rounded-md border border-slate-300 px-3 py-1.5 text-sm font-medium hover:bg-slate-50"
        >
          Regenerate address
        </button>
      )}
    </form>
  );
}
