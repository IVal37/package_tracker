import Link from "next/link";

/** The plain frame of the privacy policy and the terms. */
export function LegalPage({
  title,
  updated,
  children,
}: {
  title: string;
  /** "October 9, 2026" */
  updated: string;
  children: React.ReactNode;
}) {
  return (
    <main className="mx-auto max-w-2xl space-y-6 px-4 py-10 text-sm leading-6 text-slate-700 [&_h2]:pt-2 [&_h2]:text-base [&_h2]:font-semibold [&_h2]:text-slate-900 [&_li]:ml-5 [&_li]:list-disc">
      <Link href="/" className="font-semibold text-link">
        Wayfind
      </Link>
      <div>
        <h1 className="text-xl font-semibold text-slate-900">{title}</h1>
        <p className="text-xs text-slate-500">Last updated {updated}</p>
      </div>
      {children}
      <LegalLinks />
    </main>
  );
}

/** Links to the privacy policy and terms, for page footers. */
export function LegalLinks() {
  return (
    <nav aria-label="Legal" className="flex gap-4 text-xs text-slate-500">
      <Link href="/privacy" className="hover:underline">
        Privacy
      </Link>
      <Link href="/terms" className="hover:underline">
        Terms
      </Link>
    </nav>
  );
}
