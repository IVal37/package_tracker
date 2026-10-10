"use client";

import { useEffect } from "react";
import { reportClientErrorAction } from "./error-actions";
import "./globals.css";

/**
 * Shown when even the root layout fails. A server error carries a digest and
 * was already reported on the server; one that happened only in the browser
 * is reported by its class name.
 */
export default function GlobalError({
  error,
  retry,
}: {
  error: Error & { digest?: string };
  retry: () => void;
}) {
  useEffect(() => {
    if (!error.digest) {
      reportClientErrorAction(error.name).catch(() => {
        // Nothing more can be done from here.
      });
    }
  }, [error]);

  return (
    <html lang="en">
      <body>
        <main className="mx-auto flex min-h-screen max-w-sm flex-col justify-center gap-4 px-4">
          <title>Something went wrong · Wayfind</title>
          <h1 className="text-lg font-semibold">Something went wrong</h1>
          <p className="text-sm text-slate-600">
            We have been told about it. Try again, and if it keeps happening,
            come back in a little while.
          </p>
          <button
            type="button"
            onClick={() => retry()}
            className="rounded-md bg-brand-600 px-3 py-2 text-sm font-medium text-white hover:bg-brand-700"
          >
            Try again
          </button>
        </main>
      </body>
    </html>
  );
}
