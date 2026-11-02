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

const TAB = "hover-glass rounded-full px-3 py-1.5 text-sm";
const TAB_CURRENT = "glass-pill rounded-full px-3 py-1.5 text-sm font-medium";

export function SiteHeader({
  email,
  signOutAction,
  removeDeviceAction,
  current,
}: SiteHeaderProps) {
  return (
    // The glass is a ::before layer, so the Upgrade popup below can still be
    // fixed to the whole window.
    <header className="glass sticky top-3 z-40 mx-auto mt-3 flex w-[calc(100%-2rem)] max-w-[46rem] flex-wrap items-center justify-between gap-x-3 gap-y-2 rounded-sheet px-4 py-2">
      <Wordmark compact />
      <div className="flex flex-wrap items-center gap-1.5 sm:gap-2">
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
        <span
          title={email}
          className="hidden max-w-[12rem] truncate text-sm text-slate-500 md:inline"
        >
          {email}
        </span>
        <SignOutForm
          signOutAction={signOutAction}
          removeDeviceAction={removeDeviceAction}
        />
      </div>
    </header>
  );
}
