"use client";

import { useEffect, useId, useRef, type ReactNode } from "react";

const FOCUSABLE =
  'a[href], button, input, select, textarea, summary, [tabindex]:not([tabindex="-1"])';

/** Tab and Shift+Tab cycle through the dialog's own controls only. */
function keepFocusInside(event: KeyboardEvent, panel: HTMLElement) {
  const focusable = [...panel.querySelectorAll<HTMLElement>(FOCUSABLE)].filter(
    (element) => !element.hasAttribute("disabled"),
  );
  const first = focusable[0];
  const last = focusable[focusable.length - 1];
  if (!first || !last) {
    event.preventDefault();
    panel.focus();
    return;
  }
  const active = document.activeElement;
  const outside = !panel.contains(active);
  if (event.shiftKey && (active === first || active === panel || outside)) {
    event.preventDefault();
    last.focus();
  } else if (!event.shiftKey && (active === last || outside)) {
    event.preventDefault();
    first.focus();
  }
}

interface ModalProps {
  title: string;
  /** Leave out for a dialog that must be answered: no Escape, backdrop or ×. */
  onClose?: () => void;
  children: ReactNode;
  variant?: "center" | "drawer";
}

/**
 * Accessible modal dialog: Escape, backdrop click and × close it, unless it has
 * no onClose, in which case only its own buttons can. Tab stays inside, and
 * focus returns to where it was on close.
 */
export function Modal({
  title,
  onClose,
  children,
  variant = "center",
}: ModalProps) {
  const titleId = useId();
  const panelRef = useRef<HTMLDivElement>(null);
  // Keep the latest onClose without re-running the focus effect on re-render.
  const onCloseRef = useRef(onClose);
  useEffect(() => {
    onCloseRef.current = onClose;
  });

  useEffect(() => {
    // Focus goes back where it was when the dialog closes.
    const opener =
      document.activeElement instanceof HTMLElement
        ? document.activeElement
        : null;
    panelRef.current?.focus();
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") onCloseRef.current?.();
      if (event.key === "Tab" && panelRef.current) {
        keepFocusInside(event, panelRef.current);
      }
    };
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("keydown", onKeyDown);
      if (opener?.isConnected) opener.focus();
    };
  }, []);

  const layout =
    variant === "drawer"
      ? "ml-auto h-full w-full max-w-md animate-sheet-side"
      : "m-auto w-full max-w-sm animate-sheet";

  return (
    <div className="fixed inset-0 z-50 flex p-3 sm:p-4">
      <div
        data-testid="modal-backdrop"
        aria-hidden="true"
        className="glass-scrim absolute inset-0"
        onClick={onClose}
      />
      <div
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        tabIndex={-1}
        className={`glass-strong flex max-h-full flex-col rounded-sheet outline-none ${layout}`}
      >
        {/* The glass is on the dialog above; only this part scrolls. */}
        <div className="min-h-0 flex-1 overflow-y-auto rounded-[inherit] p-5">
          <div className="mb-4 flex items-start justify-between gap-4">
            <h2 id={titleId} className="text-lg font-semibold">
              {title}
            </h2>
            {onClose && (
              <button
                type="button"
                aria-label="Close"
                onClick={onClose}
                className="hover-glass grid size-8 shrink-0 place-items-center rounded-full text-slate-500"
              >
                ×
              </button>
            )}
          </div>
          {children}
        </div>
      </div>
    </div>
  );
}
