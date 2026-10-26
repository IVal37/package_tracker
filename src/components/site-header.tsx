import Link from "next/link";
import { SignOutForm } from "./sign-out-form";
import { UpgradeButton } from "./upgrade-button";
import { Wordmark } from "./wordmark";

interface SiteHeaderProps {
  email: string;
  signOutAction: () => Promise<void>;
  /** Stops alerts to this device when signing out. */
  removeDeviceAction?: (endpoint: string) => Promise<void>;
  /** The tab being shown, so it can be marked as the current page. */
  current?: "setup" | "settings";
}

const TAB = "rounded-md px-3 py-1.5 text-sm hover:bg-slate-100";
const TAB_CURRENT = "rounded-md bg-slate-100 px-3 py-1.5 text-sm font-medium";

export function SiteHeader({
  email,
  signOutAction,
  removeDeviceAction,
  current,
}: SiteHeaderProps) {
  return (
    <header className="flex flex-wrap items-center justify-between gap-4 border-b border-slate-200 bg-surface px-4 py-3">
      <Wordmark />
      <div className="flex flex-wrap items-center gap-3">
        <Link
          href="/setup"
          aria-current={current === "setup" ? "page" : undefined}
          className={current === "setup" ? TAB_CURRENT : TAB}
        >
          Setup
        </Link>
        <Link
          href="/settings"
          aria-current={current === "settings" ? "page" : undefined}
          className={current === "settings" ? TAB_CURRENT : TAB}
        >
          Settings
        </Link>
        <UpgradeButton />
        <span className="hidden text-sm text-slate-500 sm:inline">{email}</span>
        <SignOutForm
          signOutAction={signOutAction}
          removeDeviceAction={removeDeviceAction}
        />
      </div>
    </header>
  );
}
