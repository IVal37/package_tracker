import Link from "next/link";
import { UpgradeButton } from "./upgrade-button";
import { Wordmark } from "./wordmark";

interface SiteHeaderProps {
  email: string;
  signOutAction: () => Promise<void>;
}

export function SiteHeader({ email, signOutAction }: SiteHeaderProps) {
  return (
    <header className="flex flex-wrap items-center justify-between gap-4 border-b border-slate-200 bg-white px-4 py-3">
      <Wordmark />
      <div className="flex items-center gap-3">
        <Link
          href="/settings"
          className="rounded-md px-3 py-1.5 text-sm hover:bg-slate-100"
        >
          Settings
        </Link>
        <UpgradeButton />
        <span className="hidden text-sm text-slate-500 sm:inline">{email}</span>
        <form action={signOutAction}>
          <button
            type="submit"
            className="rounded-md px-3 py-1.5 text-sm hover:bg-slate-100"
          >
            Sign out
          </button>
        </form>
      </div>
    </header>
  );
}
