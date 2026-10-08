import Link from "next/link";

export type View = "list" | "map";

const LINKS: { view: View; label: string; href: string }[] = [
  { view: "list", label: "List", href: "/" },
  { view: "map", label: "Map", href: "/?view=map" },
];

/** List / Map switch. The view lives in the URL, so it is shareable and survives reload. */
export function ViewToggle({ view }: { view: View }) {
  return (
    <nav
      aria-label="View"
      className="inline-flex rounded-md border border-slate-300 bg-white p-0.5 text-sm"
    >
      {LINKS.map((link) => (
        <Link
          key={link.view}
          href={link.href}
          aria-current={link.view === view ? "page" : undefined}
          className={
            link.view === view
              ? "rounded bg-slate-900 px-3 py-1 font-medium text-white"
              : "rounded px-3 py-1 text-slate-700 hover:bg-slate-100"
          }
        >
          {link.label}
        </Link>
      ))}
    </nav>
  );
}
