"use client";

import { useActionState, useEffect, useRef } from "react";
import { FIELD, type SettingsFormState } from "@/lib/notifications/form";
import {
  formatTimeOfDay,
  type NotificationPrefs,
} from "@/lib/notifications/prefs";
import {
  NOTIFICATION_KINDS,
  type NotificationKind,
} from "@/lib/notifications/rules";

const LABELS: Record<NotificationKind, { name: string; hint: string }> = {
  out_for_delivery: {
    name: "Out for delivery",
    hint: "It is on the final leg",
  },
  delivered: {
    name: "Delivered or ready for pickup",
    hint: "It arrived, or is waiting for you",
  },
  problem: {
    name: "Problems",
    hint: "An exception, or a delivery attempt that failed",
  },
  delay: {
    name: "Delays",
    hint: "The estimate moved later, or it is overdue",
  },
};

interface NotificationSettingsFormProps {
  prefs: NotificationPrefs;
  /** True while the stored zone is only the default, so the browser's can be offered. */
  suggestBrowserZone: boolean;
  timeZones: string[];
  action: (
    state: SettingsFormState,
    formData: FormData,
  ) => Promise<SettingsFormState>;
}

export function NotificationSettingsForm({
  prefs,
  suggestBrowserZone,
  timeZones,
  action,
}: NotificationSettingsFormProps) {
  const [state, formAction, pending] = useActionState<
    SettingsFormState,
    FormData
  >(action, { status: "idle" });
  const zoneRef = useRef<HTMLInputElement>(null);

  // A user who has never saved settings gets their own time zone filled in.
  useEffect(() => {
    if (!suggestBrowserZone || !zoneRef.current) return;
    try {
      zoneRef.current.value = Intl.DateTimeFormat().resolvedOptions().timeZone;
    } catch {
      // Keep the default.
    }
  }, [suggestBrowserZone]);

  return (
    <form action={formAction} className="space-y-6">
      <fieldset>
        <legend className="mb-2 text-sm font-semibold">Alerts</legend>
        <table className="w-full text-sm">
          <thead>
            <tr className="text-left text-slate-500">
              <th scope="col" className="py-1 pr-3 font-normal">
                Tell me when
              </th>
              <th scope="col" className="w-16 py-1 text-center font-normal">
                Push
              </th>
              <th scope="col" className="w-16 py-1 text-center font-normal">
                Email
              </th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {NOTIFICATION_KINDS.map((kind) => (
              <tr key={kind}>
                <th scope="row" className="py-2 pr-3 text-left font-normal">
                  <span className="block font-medium">{LABELS[kind].name}</span>
                  <span className="block text-xs text-slate-500">
                    {LABELS[kind].hint}
                  </span>
                </th>
                <td className="text-center">
                  <input
                    type="checkbox"
                    name={FIELD.push(kind)}
                    defaultChecked={prefs.push[kind]}
                    aria-label={`${LABELS[kind].name} by push`}
                  />
                </td>
                <td className="text-center">
                  <input
                    type="checkbox"
                    name={FIELD.email(kind)}
                    defaultChecked={prefs.email[kind]}
                    aria-label={`${LABELS[kind].name} by email`}
                  />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </fieldset>

      <fieldset className="space-y-3">
        <legend className="text-sm font-semibold">Quiet hours</legend>
        <label className="flex items-center gap-2 text-sm">
          <input
            type="checkbox"
            name={FIELD.quietEnabled}
            defaultChecked={prefs.quiet.enabled}
          />
          Hold alerts during quiet hours and send them when they end
        </label>
        <div className="flex flex-wrap items-end gap-3 text-sm">
          <label className="block">
            <span className="mb-1 block text-slate-600">From</span>
            <input
              type="time"
              name={FIELD.quietStart}
              defaultValue={formatTimeOfDay(prefs.quiet.start)}
              required
              className="rounded-md border border-slate-300 px-2 py-1"
            />
          </label>
          <label className="block">
            <span className="mb-1 block text-slate-600">Until</span>
            <input
              type="time"
              name={FIELD.quietEnd}
              defaultValue={formatTimeOfDay(prefs.quiet.end)}
              required
              className="rounded-md border border-slate-300 px-2 py-1"
            />
          </label>
          <label className="block">
            <span className="mb-1 block text-slate-600">Time zone</span>
            <input
              ref={zoneRef}
              name={FIELD.timeZone}
              list="time-zones"
              defaultValue={prefs.quiet.timeZone}
              required
              autoComplete="off"
              className="w-56 rounded-md border border-slate-300 px-2 py-1"
            />
            <datalist id="time-zones">
              {timeZones.map((zone) => (
                <option key={zone} value={zone} />
              ))}
            </datalist>
          </label>
        </div>
      </fieldset>

      <div className="flex items-center gap-3">
        <button
          type="submit"
          disabled={pending}
          className="rounded-md bg-brand-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-brand-700 disabled:opacity-60"
        >
          {pending ? "Saving…" : "Save settings"}
        </button>
        {state.status === "saved" && (
          <p role="status" className="text-sm text-green-700">
            Saved.
          </p>
        )}
        {state.status === "error" && (
          <p role="alert" className="text-sm text-red-600">
            {state.message}
          </p>
        )}
      </div>
    </form>
  );
}
