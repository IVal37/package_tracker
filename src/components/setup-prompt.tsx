import Link from "next/link";
import { Modal } from "./modal";

interface SetupPromptProps {
  completeAction: () => Promise<void>;
  skipAction: () => Promise<void>;
}

/**
 * Shown on the list page to someone who has never answered. It has no close
 * button and ignores Escape and outside clicks, so they choose; Skip is one
 * click. The guide itself lives on /setup: it is too long (and the Gmail
 * confirmation updates live) to fit in a dialog.
 */
export function SetupPrompt({ completeAction, skipAction }: SetupPromptProps) {
  return (
    <Modal title="Welcome to Wayfind">
      <div className="space-y-4 text-sm text-slate-700">
        <p>A few minutes of setup makes Wayfind much more useful:</p>
        <ul className="list-disc space-y-1 pl-5">
          <li>
            Forward your order emails, so packages appear by themselves. For
            Gmail and Outlook this is done once, on a computer.
          </li>
          <li>Put Wayfind on your phone or computer like an app.</li>
          <li>Turn on alerts on each device you use.</li>
        </ul>
        <Link
          href="/setup"
          className="block rounded-md bg-brand-600 px-4 py-2 text-center font-medium text-white hover:bg-brand-700"
        >
          Open the setup guide
        </Link>
        <div className="flex flex-col gap-2">
          <form action={completeAction}>
            <button
              type="submit"
              className="w-full rounded-md border border-slate-300 px-4 py-2 font-medium hover:bg-slate-50"
            >
              I&rsquo;ve finished setup
            </button>
          </form>
          <form action={skipAction}>
            <button
              type="submit"
              className="w-full rounded-md border border-slate-300 px-4 py-2 font-medium hover:bg-slate-50"
            >
              Skip, I&rsquo;ll do it later
            </button>
          </form>
        </div>
        <p className="text-slate-600">
          You can find the guide any time under Setup in the header.
        </p>
      </div>
    </Modal>
  );
}
