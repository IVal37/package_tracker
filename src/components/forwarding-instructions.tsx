/** How to send order and shipping emails to the private address. Static text. */
export function ForwardingInstructions({ address }: { address: string }) {
  return (
    <div className="space-y-6 text-sm text-slate-700">
      <section aria-labelledby="gmail-steps">
        <h3 id="gmail-steps" className="mb-2 font-semibold">
          Gmail
        </h3>
        <ol className="list-decimal space-y-1 pl-5">
          <li>
            In Gmail, open Settings → See all settings → Forwarding and
            POP/IMAP, then choose Add a forwarding address and enter{" "}
            <span className="font-mono">{address}</span>.
          </li>
          <li>
            Gmail sends a confirmation code to that address. It will appear on
            this page within a minute; enter it in Gmail to finish.
          </li>
          <li>
            Open Filters and Blocked Addresses → Create a new filter. Match
            order and shipping mail, for example a subject containing
            &ldquo;order&rdquo; or &ldquo;shipped&rdquo;, and choose Forward it
            to this address.
          </li>
        </ol>
      </section>
      <section aria-labelledby="outlook-steps">
        <h3 id="outlook-steps" className="mb-2 font-semibold">
          Outlook
        </h3>
        <ol className="list-decimal space-y-1 pl-5">
          <li>Open Settings → Mail → Rules → Add new rule.</li>
          <li>
            Add a condition such as &ldquo;Subject includes&rdquo; order or
            shipped.
          </li>
          <li>
            Add the action Forward to and enter{" "}
            <span className="font-mono">{address}</span>. Outlook does not ask
            for a confirmation code.
          </li>
        </ol>
      </section>
    </div>
  );
}
