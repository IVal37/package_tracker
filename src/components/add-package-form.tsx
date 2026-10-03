"use client";

import { useActionState } from "react";
import {
  ADD_PACKAGE_MESSAGES,
  type AddPackageState,
} from "@/lib/shipments/form-state";

interface AddPackageFormProps {
  action: (
    state: AddPackageState,
    formData: FormData,
  ) => Promise<AddPackageState>;
}

export function AddPackageForm({ action }: AddPackageFormProps) {
  const [state, formAction, pending] = useActionState<
    AddPackageState,
    FormData
  >(action, { status: "idle" });

  const error = state.status === "error" ? state : null;
  const values = error?.values;
  const generalMessage =
    error && error.error !== "invalid"
      ? ADD_PACKAGE_MESSAGES[error.error]
      : null;

  return (
    <form
      action={formAction}
      className="rounded-lg border border-slate-200 bg-white p-4"
    >
      <h2 className="mb-3 font-semibold">Add a package</h2>
      <div className="grid gap-3 sm:grid-cols-[2fr_1fr_auto] sm:items-start">
        <div>
          <label htmlFor="trackingNumber" className="sr-only">
            Tracking number
          </label>
          <input
            id="trackingNumber"
            name="trackingNumber"
            placeholder="Tracking number"
            autoComplete="off"
            required
            defaultValue={values?.trackingNumber}
            aria-invalid={Boolean(error?.fieldErrors.trackingNumber)}
            aria-describedby={
              error?.fieldErrors.trackingNumber
                ? "trackingNumber-error"
                : undefined
            }
            className="w-full rounded-md border border-slate-300 px-3 py-2"
          />
          {error?.fieldErrors.trackingNumber && (
            <p id="trackingNumber-error" className="mt-1 text-sm text-red-600">
              {error.fieldErrors.trackingNumber}
            </p>
          )}
        </div>
        <div>
          <label htmlFor="nickname" className="sr-only">
            Nickname (optional)
          </label>
          <input
            id="nickname"
            name="nickname"
            placeholder="Nickname (optional)"
            autoComplete="off"
            defaultValue={values?.nickname}
            aria-invalid={Boolean(error?.fieldErrors.nickname)}
            aria-describedby={
              error?.fieldErrors.nickname ? "nickname-error" : undefined
            }
            className="w-full rounded-md border border-slate-300 px-3 py-2"
          />
          {error?.fieldErrors.nickname && (
            <p id="nickname-error" className="mt-1 text-sm text-red-600">
              {error.fieldErrors.nickname}
            </p>
          )}
        </div>
        <button
          type="submit"
          disabled={pending}
          className="rounded-md bg-brand-600 px-4 py-2 font-medium text-white hover:bg-brand-700 disabled:opacity-60"
        >
          {pending ? "Adding…" : "Add"}
        </button>
      </div>
      {generalMessage && (
        <p role="alert" className="mt-3 text-sm text-red-600">
          {generalMessage}
        </p>
      )}
      {state.status === "success" && (
        <p role="status" className="mt-3 text-sm text-green-700">
          Package added.
        </p>
      )}
    </form>
  );
}
