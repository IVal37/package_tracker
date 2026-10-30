import {
  describeSetup,
  setupState,
  type SetupTimestamps,
} from "@/lib/setup/status";

interface SetupStatusProps {
  answer: SetupTimestamps;
  /** What the app can see; display only, it never changes the answer. */
  emailsArriving: boolean;
  pushDevices: number;
  completeAction: () => Promise<void>;
  skipAction: () => Promise<void>;
}

const buttonClass =
  "rounded-md border border-slate-300 px-3 py-1.5 text-sm font-medium hover:bg-slate-50";

function Signal({ ok, children }: { ok: boolean; children: string }) {
  return (
    <li className="flex gap-2">
      <span aria-hidden="true" className={ok ? "text-link" : "text-slate-500"}>
        {ok ? "✓" : "○"}
      </span>
      <span>{children}</span>
    </li>
  );
}

/**
 * Where the user stands with setup: what they told us, and what we can see.
 * What they told us is theirs to change; what we can see is only shown.
 */
export function SetupStatus({
  answer,
  emailsArriving,
  pushDevices,
  completeAction,
  skipAction,
}: SetupStatusProps) {
  const state = setupState(answer);
  return (
    <section
      aria-labelledby="setup-status-heading"
      className="space-y-3 rounded-lg border border-slate-200 bg-surface p-4"
    >
      <div className="space-y-1">
        <h2 id="setup-status-heading" className="font-semibold">
          Your setup
        </h2>
        <p className="text-sm text-slate-700">{describeSetup(answer)}</p>
      </div>

      <ul className="space-y-1 text-sm text-slate-700">
        <Signal ok={emailsArriving}>
          {emailsArriving
            ? "Emails are reaching your private address."
            : "No email has reached your private address yet."}
        </Signal>
        <Signal ok={pushDevices > 0}>
          {pushDevices > 0
            ? `Alerts are on for ${pushDevices} ${pushDevices === 1 ? "device" : "devices"}.`
            : "No device is set up for push alerts yet."}
        </Signal>
      </ul>

      <div className="flex flex-wrap gap-2">
        {state !== "done" && (
          <form action={completeAction}>
            <button type="submit" className={buttonClass}>
              Mark setup as done
            </button>
          </form>
        )}
        {state === "new" && (
          <form action={skipAction}>
            <button type="submit" className={buttonClass}>
              Skip for now
            </button>
          </form>
        )}
        {state === "done" && (
          <form action={skipAction}>
            <button type="submit" className={buttonClass}>
              Mark as not done
            </button>
          </form>
        )}
      </div>
    </section>
  );
}
