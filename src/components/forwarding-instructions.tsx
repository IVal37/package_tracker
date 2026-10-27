import type { ReactNode } from "react";
import type { DeviceKind } from "@/lib/pwa/service-worker";

interface ForwardingInstructionsProps {
  address: string;
  /** Which device the reader is looking at the steps for. */
  device: DeviceKind;
  /** Lets a phone reader jump to the computer steps. */
  onShowComputer?: () => void;
}

/** One mail service (or one way of forwarding): a heading that opens its steps. */
function Method({
  id,
  title,
  where,
  children,
}: {
  id: string;
  title: string;
  where?: string;
  children: ReactNode;
}) {
  return (
    <section aria-labelledby={id}>
      <details className="rounded-lg border border-slate-200 bg-surface p-3">
        <summary className="cursor-pointer">
          <h3 id={id} className="inline font-semibold">
            {title}
          </h3>
        </summary>
        <div className="mt-3 space-y-2">
          {where && <p className="text-slate-600">{where}</p>}
          {children}
        </div>
      </details>
    </section>
  );
}

const Steps = ({ children }: { children: ReactNode }) => (
  <ol className="list-decimal space-y-1 pl-5">{children}</ol>
);

const Address = ({ address }: { address: string }) => (
  <span className="font-mono">{address}</span>
);

/** Forwarding one email by hand: works in any mail app on any device. */
function ByHand({ address, device }: { address: string; device: DeviceKind }) {
  return (
    <>
      <Steps>
        <li>Open the order or shipping email.</li>
        <li>Tap or click Forward.</li>
        <li>
          Send it to <Address address={address} />. The package appears in your
          list within a minute or two.
        </li>
      </Steps>
      {device !== "computer" && (
        <ul className="list-disc space-y-1 pl-5 text-slate-600">
          {device === "ios" && (
            <li>
              Mail on iPhone: tap the arrow at the bottom of the email, then
              Forward.
            </li>
          )}
          <li>
            Gmail app: the Forward option is under the email, or in the ⋮ menu
            at the top.
          </li>
          <li>Outlook app: open the ⋯ menu at the top, then Forward.</li>
          <li>
            Save the address as a contact called &ldquo;Wayfind&rdquo; and it
            fills in for you next time.
          </li>
        </ul>
      )}
    </>
  );
}

/**
 * How to send order and shipping emails to the private address, for the device
 * being looked at. Static text; the address is only ever shown as text.
 */
export function ForwardingInstructions({
  address,
  device,
  onShowComputer,
}: ForwardingInstructionsProps) {
  if (device !== "computer") {
    return (
      <div className="space-y-3 text-sm text-slate-700">
        <Method
          id="forward-by-hand"
          title="Forward an email now"
          where="Works in any mail app on this device."
        >
          <ByHand address={address} device={device} />
        </Method>
        <div className="space-y-2 rounded-lg border border-slate-200 bg-surface p-3">
          <h3 className="font-semibold">Forward them automatically</h3>
          <p>
            Gmail, Outlook and iCloud can forward order emails for you, but
            their phone apps can&rsquo;t set that up. Do it once on a computer,
            and from then on it happens by itself.
          </p>
          <p className="text-slate-600">
            Yahoo only forwards automatically on a paid plan, so forward by hand
            there.
          </p>
          {onShowComputer && (
            <button
              type="button"
              onClick={onShowComputer}
              className="rounded-md border border-slate-300 px-3 py-1.5 font-medium hover:bg-slate-50"
            >
              Show the computer steps
            </button>
          )}
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-3 text-sm text-slate-700">
      <Method
        id="gmail-steps"
        title="Gmail"
        where="On a computer, at gmail.com. The Gmail phone app can&rsquo;t do this."
      >
        <Steps>
          <li>
            In Gmail, open Settings → See all settings → Forwarding and
            POP/IMAP, then choose Add a forwarding address and enter{" "}
            <Address address={address} />.
          </li>
          <li>
            Gmail sends a confirmation link (sometimes a code) to that address.
            It will appear on this page within a minute; open the link, or enter
            the code in Gmail, to finish.
          </li>
          <li>
            Open Filters and Blocked Addresses → Create a new filter. Match
            order and shipping mail, for example a subject containing
            &ldquo;order&rdquo; or &ldquo;shipped&rdquo;, and choose Forward it
            to this address.
          </li>
        </Steps>
      </Method>
      <Method
        id="outlook-steps"
        title="Outlook"
        where="On a computer, at outlook.com. The Outlook phone app can&rsquo;t make rules."
      >
        <Steps>
          <li>Open Settings → Mail → Rules → Add new rule.</li>
          <li>
            Add a condition such as &ldquo;Subject includes&rdquo; order or
            shipped.
          </li>
          <li>
            Add the action Forward to and enter <Address address={address} />.
            Outlook does not ask for a confirmation code.
          </li>
        </Steps>
        <p className="text-slate-600">
          Some work and school accounts block forwarding to outside addresses.
          If yours does, forward by hand.
        </p>
      </Method>
      <Method
        id="icloud-steps"
        title="iCloud Mail"
        where="On a computer, at icloud.com/mail."
      >
        <Steps>
          <li>Open Settings → Rules → Add a Rule.</li>
          <li>
            Set the condition to a subject containing &ldquo;order&rdquo; or
            &ldquo;shipped&rdquo;.
          </li>
          <li>
            Choose a forward action and enter <Address address={address} />. If
            your rules don&rsquo;t offer forwarding, forward by hand instead.
          </li>
        </Steps>
        <p className="text-slate-600">
          Don&rsquo;t use iCloud&rsquo;s &ldquo;forward all my email&rdquo;
          option: it would send us everything, not just your orders.
        </p>
      </Method>
      <Method id="yahoo-steps" title="Yahoo Mail">
        <p>
          Yahoo only forwards automatically on a paid plan, so forward each
          order email by hand.
        </p>
        <ByHand address={address} device="computer" />
      </Method>
      <Method
        id="by-hand-steps"
        title="Any other mail app"
        where="Works with any mail service."
      >
        <ByHand address={address} device="computer" />
      </Method>
    </div>
  );
}
