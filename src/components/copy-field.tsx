"use client";

import { useCopy } from "./copy-button";

/**
 * Text the reader must paste exactly, in its own box. The whole box is the
 * button: one click copies it. The text is only ever shown as text.
 */
export function CopyField({
  text,
  compact = false,
}: {
  text: string;
  /** Sizes the box to its text instead of the full width. */
  compact?: boolean;
}) {
  const { copied, copy } = useCopy(text);

  return (
    <button
      type="button"
      onClick={copy}
      title="Click to copy"
      className={`glass-field flex items-center justify-between gap-3 rounded-xl border-2 border-dashed border-brand-600 px-3 py-2 text-left ${
        compact ? "w-fit max-w-full" : "w-full"
      }`}
    >
      <span className="break-all font-mono text-sm font-medium text-slate-900">
        {text}
      </span>
      <span
        aria-live="polite"
        className="shrink-0 rounded-full bg-brand-50 px-2.5 py-0.5 text-xs font-semibold text-link"
      >
        {copied ? "Copied ✓" : "Click to copy"}
      </span>
    </button>
  );
}
