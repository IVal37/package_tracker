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
      data-view={view}
      className="glass group inline-grid grid-cols-2 rounded-full p-1 text-sm"
    >
      {/* The pill is a sibling behind the links, so it can slide between them. */}
      <span
        aria-hidden="true"
        className="glass-pill pointer-events-none absolute inset-y-1 left-1 w-[calc(50%-0.25rem)] rounded-full transition-transform duration-300 ease-out group-data-[view=map]:translate-x-full motion-reduce:transition-none"
      />
      {LINKS.map((link) => (
        <Link
          key={link.view}
          href={link.href}
          aria-current={link.view === view ? "page" : undefined}
          className={
            link.view === view
              ? "relative rounded-full px-5 py-1.5 text-center font-medium text-slate-900"
              : "hover-glass relative rounded-full px-5 py-1.5 text-center text-slate-700"
          }
        >
          {link.label}
        </Link>
      ))}
    </nav>
  );
}
