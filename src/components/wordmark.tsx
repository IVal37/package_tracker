/** `compact` drops the tagline, for the header bar. */
export function Wordmark({ compact = false }: { compact?: boolean }) {
  return (
    <div>
      <h1 className="text-xl font-semibold tracking-tight text-link">
        Wayfind
      </h1>
      {!compact && (
        <p className="text-sm text-slate-500">Every package, one place.</p>
      )}
    </div>
  );
}
