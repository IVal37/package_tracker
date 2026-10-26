"use client";

import { useActionState } from "react";
import type { FailedEmailState } from "@/app/settings/actions";

export interface FailedEmailItem {
  id: string;
  /** From the email: untrusted, rendered as text only. */
  from: string | null;
  subject: string | null;
  /** Already formatted, e.g. "2 days ago". */
  received: string;
  reason: string;
}

type Action = (
  previous: FailedEmailState,
  formData: FormData,
) => Promise<FailedEmailState>;

const IDLE: FailedEmailState = { status: "idle" };

const MESSAGES: Record<Exclude<FailedEmailState["status"], "idle">, string> = {
  retried: "Reading it again. It will leave this list if it works.",
  dismissed: "Removed.",
  rate_limited: "That is a lot of retries. Try again in an hour.",
  not_found: "That email is no longer here.",
};

/**
 * The forwarded emails that could not be read, newest first, each with Try
 * again and Dismiss. Senders and subjects come from the emails and are shown
 * as plain text.
 */
export function FailedEmails({
  emails,
  total,
  retryAction,
  dismissAction,
}: {
  emails: FailedEmailItem[];
  /** How many there are in all; only the newest are listed. */
  total: number;
  retryAction: Action;
  dismissAction: Action;
}) {
  const [retryState, retry, retrying] = useActionState(retryAction, IDLE);
  const [dismissState, dismiss, dismissing] = useActionState(
    dismissAction,
    IDLE,
  );
  const latest = dismissState.status !== "idle" ? dismissState : retryState;
  const busy = retrying || dismissing;

  if (emails.length === 0) return null;

  return (
    <section
      aria-labelledby="failed-heading"
      className="space-y-3 rounded-lg border border-amber-300 bg-amber-50 p-4"
    >
      <h3 id="failed-heading" className="font-semibold">
        Emails we couldn&apos;t read
      </h3>
      <p className="text-sm text-slate-600">
        {total === 1
          ? "1 forwarded email couldn't be read."
          : `${total} forwarded emails couldn't be read.`}{" "}
        Try again, or add the package by hand with its tracking number.
        {total > emails.length && ` The newest ${emails.length} are shown.`}
      </p>
      <ul className="divide-y divide-amber-200">
        {emails.map((email) => (
          <li key={email.id} className="space-y-1 py-2">
            <p className="text-sm font-medium break-words">
              {email.subject || "(no subject)"}
            </p>
            <p className="text-xs text-slate-600 break-words">
              {email.from || "Unknown sender"} · {email.received}
            </p>
            <p className="text-xs text-slate-600">{email.reason}</p>
            <div className="flex gap-2 pt-1">
              <form action={retry}>
                <input type="hidden" name="emailId" value={email.id} />
                <button
                  type="submit"
                  disabled={busy}
                  className="rounded-md border border-slate-300 bg-surface px-2.5 py-1 text-xs font-medium hover:bg-slate-50 disabled:opacity-60"
                >
                  Try again
                </button>
              </form>
              <form action={dismiss}>
                <input type="hidden" name="emailId" value={email.id} />
                <button
                  type="submit"
                  disabled={busy}
                  className="rounded-md px-2.5 py-1 text-xs hover:bg-amber-100 disabled:opacity-60"
                >
                  Dismiss
                </button>
              </form>
            </div>
          </li>
        ))}
      </ul>
      {latest.status !== "idle" && (
        <p role="status" className="text-sm text-slate-700">
          {MESSAGES[latest.status]}
        </p>
      )}
    </section>
  );
}
