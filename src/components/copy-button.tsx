"use client";

import { useState } from "react";

interface CopyButtonProps {
  text: string;
  label?: string;
}

/** Copies text to the clipboard and says so. Quietly does nothing if the browser refuses. */
export function useCopy(text: string) {
  const [copied, setCopied] = useState(false);

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
    } catch {
      setCopied(false);
    }
  };

  return { copied, copy };
}

/** A button that copies `text` to the clipboard. */
export function CopyButton({ text, label = "Copy" }: CopyButtonProps) {
  const { copied, copy } = useCopy(text);

  return (
    <button
      type="button"
      onClick={copy}
      className="btn-soft rounded-full px-3 py-1.5 text-sm font-medium"
    >
      {copied ? "Copied" : label}
    </button>
  );
}
