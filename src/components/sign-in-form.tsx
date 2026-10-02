"use client";

import { useActionState } from "react";
import type { SignInState } from "@/app/sign-in/actions";

interface SignInFormProps {
  action: (state: SignInState, formData: FormData) => Promise<SignInState>;
}

export function SignInForm({ action }: SignInFormProps) {
  const [state, formAction, pending] = useActionState<SignInState, FormData>(
    action,
    { status: "idle" },
  );

  if (state.status === "sent") {
    return (
      <p role="status" className="rounded-md bg-brand-50 p-4 text-sm">
        Check your email for a sign-in link.
      </p>
    );
  }

  return (
    <form action={formAction} className="space-y-3">
      <label htmlFor="email" className="block text-sm font-medium">
        Email
      </label>
      <input
        id="email"
        name="email"
        type="email"
        autoComplete="email"
        required
        className="w-full rounded-md border border-slate-300 px-3 py-2"
      />
      {state.status === "error" && (
        <p role="alert" className="text-sm text-red-600">
          {state.message}
        </p>
      )}
      <button
        type="submit"
        disabled={pending}
        className="w-full rounded-md bg-brand-600 px-3 py-2 font-medium text-white hover:bg-brand-700 disabled:opacity-60"
      >
        {pending ? "Sending…" : "Email me a sign-in link"}
      </button>
    </form>
  );
}
