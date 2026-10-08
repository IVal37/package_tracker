"use client";

import { useState } from "react";

interface CopyButtonProps {
  text: string;
  label?: string;
}

/** Copies text to the clipboard and says so. Quietly does nothing if the browser refuses. */
export function CopyButton({ text, label = "Copy" }: CopyButtonProps) {
  const [copied, setCopied] = useState(false);

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
    } catch {
      setCopied(false);
    }
  };

  return (
    <button
      type="button"
      onClick={copy}
      className="rounded-md border border-slate-300 px-3 py-1.5 text-sm font-medium hover:bg-slate-50"
    >
      {copied ? "Copied" : label}
    </button>
  );
}
