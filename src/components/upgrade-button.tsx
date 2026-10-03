"use client";

import { useRef, useState } from "react";
import { Modal } from "./modal";

/** Payments are out of scope for the MVP: this only opens a "Coming soon" dialog. */
export function UpgradeButton() {
  const [open, setOpen] = useState(false);
  const triggerRef = useRef<HTMLButtonElement>(null);

  const close = () => {
    setOpen(false);
    triggerRef.current?.focus();
  };

  return (
    <>
      <button
        ref={triggerRef}
        type="button"
        onClick={() => setOpen(true)}
        className="rounded-md border border-brand-600 px-3 py-1.5 text-sm font-medium text-brand-700 hover:bg-brand-50"
      >
        Upgrade
      </button>
      {open && (
        <Modal title="Coming soon" onClose={close}>
          <p className="mb-4 text-sm text-slate-600">
            Paid plans aren&apos;t available yet. Wayfind is free while we get
            things right.
          </p>
          <button
            type="button"
            onClick={close}
            className="rounded-md bg-brand-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-brand-700"
          >
            Got it
          </button>
        </Modal>
      )}
    </>
  );
}
