"use client";

import { useActionState, useEffect, useState } from "react";
import type { DeleteAccountState } from "@/app/settings/actions";
import { DELETE_CONFIRMATION } from "@/lib/privacy/confirm";
import { forgetThisDevice } from "@/lib/pwa/device-cleanup";

type Action = (
  previous: DeleteAccountState,
  formData: FormData,
) => Promise<DeleteAccountState>;

const IDLE: DeleteAccountState = { status: "idle" };

const MESSAGES: Record<"unconfirmed" | "rate_limited" | "unavailable", string> =
  {
    unconfirmed: `Type ${DELETE_CONFIRMATION} to confirm.`,
    rate_limited: "Too many attempts. Try again in an hour.",
    unavailable:
      "Account deletion isn't available right now. Nothing was deleted. Please contact us.",
  };

/**
 * Deletes the account after the user types the confirmation word. Once the
 * server says it is done, this device's saved list and push subscription are
 * cleared and the browser leaves for the "deleted" page.
 */
export function DeleteAccount({
  action,
  leave = (url: string) => window.location.assign(url),
}: {
  action: Action;
  /** Navigates away; replaceable in tests. */
  leave?: (url: string) => void;
}) {
  const [state, submit, pending] = useActionState(action, IDLE);
  const [typed, setTyped] = useState("");

  useEffect(() => {
    if (state.status !== "deleted") return;
    const target = state.signInRemoved
      ? "/account-deleted"
      : "/account-deleted?signin=kept";
    // The server forgot this device with the account; the browser forgets too.
    void forgetThisDevice({ removeFromServer: async () => {} }).finally(() =>
      leave(target),
    );
  }, [state, leave]);

  return (
    <form action={submit} className="space-y-2">
      <label htmlFor="confirm-delete" className="block text-sm text-slate-700">
        Type <strong>{DELETE_CONFIRMATION}</strong> to delete your account, your
        packages, forwarded emails and alerts for good.
      </label>
      <div className="flex flex-wrap gap-2">
        <input
          id="confirm-delete"
          name="confirm"
          autoComplete="off"
          value={typed}
          onChange={(event) => setTyped(event.target.value)}
          className="rounded-md border border-slate-300 px-2 py-1.5 text-sm"
        />
        <button
          type="submit"
          disabled={pending || typed.trim() !== DELETE_CONFIRMATION}
          className="rounded-md bg-red-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-red-700 disabled:opacity-60"
        >
          {pending ? "Deleting…" : "Delete my account"}
        </button>
      </div>
      {state.status !== "idle" && state.status !== "deleted" && (
        <p role="alert" className="text-sm text-danger">
          {MESSAGES[state.status]}
        </p>
      )}
      {state.status === "deleted" && (
        <p role="status" className="text-sm text-slate-700">
          Your account is deleted. Signing you out…
        </p>
      )}
    </form>
  );
}
