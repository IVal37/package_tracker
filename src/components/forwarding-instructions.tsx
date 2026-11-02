import type { ReactNode } from "react";
import type { DeviceKind } from "@/lib/pwa/service-worker";
import { CopyField } from "./copy-field";

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
      <details className="rounded-card glass-card p-3">
        <summary className="cursor-pointer">
          <h3 id={id} className="inline font-semibold">
            {title}
          </h3>
        </summary>
        <div className="mt-3 space-y-3">
          {where && <p className="text-slate-600">{where}</p>}
          {children}
        </div>
      </details>
    </section>
  );
}

/** Numbered steps; a step may end with boxes to copy and paste. */
const Steps = ({ children }: { children: ReactNode }) => (
  <ol className="list-decimal space-y-3 pl-5 marker:font-semibold">
    {children}
  </ol>
);

/** What the reader types or pastes goes below the step's sentence. */
const Paste = ({ children }: { children: ReactNode }) => (
  <div className="mt-2 flex flex-wrap gap-2">{children}</div>
);

/** The name of something to click or tap, coloured so it stands out from the sentence. */
const Btn = ({ children }: { children: ReactNode }) => (
  <strong className="rounded-md bg-brand-50 px-1.5 py-0.5 font-semibold text-link">
    {children}
  </strong>
);

/** A path through menus, such as Settings → Mail → Rules. */
function Path({ items }: { items: string[] }) {
  return items.map((item, index) => (
    <span key={item}>
      {index > 0 && " → "}
      <Btn>{item}</Btn>
    </span>
  ));
}

const Notes = ({ children }: { children: ReactNode }) => (
  <ul className="list-disc space-y-1 pl-5 text-slate-600">{children}</ul>
);

/** The Gmail filter's Subject box. OR must be in capitals. */
const SUBJECT_SEARCH = "order OR shipped OR shipping OR delivered OR tracking";

/** The words an Outlook or iCloud rule looks for in the subject. */
const SUBJECT_WORDS = ["order", "shipped"];

/** Forwarding one email by hand: works in any mail app on any device. */
function ByHand({ address, device }: { address: string; device: DeviceKind }) {
  return (
    <>
      <Steps>
        <li>Open the order or shipping email.</li>
        <li>
          Tap or click <Btn>Forward</Btn>.
        </li>
        <li>
          Send it to this address:
          <Paste>
            <CopyField text={address} />
          </Paste>
          <span className="mt-2 block text-slate-600">
            The package appears in your list within a minute or two.
          </span>
        </li>
      </Steps>
      {device !== "computer" && (
        <Notes>
          {device === "ios" && (
            <li>
              Mail on iPhone: tap the arrow at the bottom of the email, then{" "}
              <Btn>Forward</Btn>.
            </li>
          )}
          <li>
            Gmail app: the <Btn>Forward</Btn> option is under the email, or in
            the ⋮ menu at the top.
          </li>
          <li>
            Outlook app: open the ⋯ menu at the top, then <Btn>Forward</Btn>.
          </li>
          <li>
            Save the address as a contact called &ldquo;Wayfind&rdquo; and it
            fills in for you next time.
          </li>
        </Notes>
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
        <div className="space-y-2 rounded-card glass-card p-3">
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
              className="btn-soft rounded-full px-3 py-1.5 font-medium"
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
            In Gmail, open{" "}
            <Path
              items={[
                "Settings",
                "See all settings",
                "Forwarding and POP/IMAP",
              ]}
            />
            .
          </li>
          <li>
            Choose <Btn>Add a forwarding address</Btn>.
          </li>
          <li>
            Enter this address:
            <Paste>
              <CopyField text={address} />
            </Paste>
          </li>
          <li>
            Gmail sends a confirmation link (sometimes a code) to that address.
            Wait for it to appear on this page, within a minute. Then open the
            link, or enter the code in Gmail, to finish.
          </li>
          <li>
            Back in the same Settings page, open the{" "}
            <Btn>Filters and Blocked Addresses</Btn> tab.
          </li>
          <li>
            Choose <Btn>Create a new filter</Btn>. (Or click the{" "}
            <Btn>Show search options</Btn> icon at the right end of
            Gmail&rsquo;s search bar.)
          </li>
          <li>
            Fill in one box only. In <Btn>Subject</Btn>, paste this, with OR in
            capitals:
            <Paste>
              <CopyField text={SUBJECT_SEARCH} />
            </Paste>
          </li>
          <li>
            Click <Btn>Create filter</Btn>. It stays grey until a box has
            something in it.
          </li>
          <li>
            In the next box, tick <Btn>Forward it to</Btn> and pick this address
            from the list:
            <Paste>
              <CopyField text={address} compact />
            </Paste>
            <span className="mt-2 block">
              Leave <Btn>Also apply filter to matching conversations</Btn>{" "}
              unticked, or Gmail forwards your old mail too.
            </span>
          </li>
          <li>
            Click <Btn>Create filter</Btn> again.
          </li>
        </Steps>
        <Notes>
          <li>
            If <Btn>Forward it to</Btn> is missing or greyed out, Gmail
            hasn&rsquo;t confirmed the address yet: finish the confirmation step
            above first.
          </li>
          <li>
            A filter only catches new mail, so it starts working with your next
            order. To check it now, forward one old shipping email by hand.
          </li>
          <li>
            A filter that is too broad forwards newsletters too; that does no
            harm, but narrow it if you get a lot.
          </li>
          <li>
            To change or remove it later, go back to Filters and Blocked
            Addresses.
          </li>
        </Notes>
      </Method>
      <Method
        id="outlook-steps"
        title="Outlook"
        where="On a computer, at outlook.com. The Outlook phone app can&rsquo;t make rules."
      >
        <Steps>
          <li>
            Open <Path items={["Settings", "Mail", "Rules"]} />.
          </li>
          <li>
            Choose <Btn>Add new rule</Btn>.
          </li>
          <li>
            Add a condition <Btn>Subject includes</Btn>, with these words:
            <Paste>
              {SUBJECT_WORDS.map((word) => (
                <CopyField key={word} text={word} compact />
              ))}
            </Paste>
          </li>
          <li>
            Add the action <Btn>Forward to</Btn> and enter this address:
            <Paste>
              <CopyField text={address} />
            </Paste>
            <span className="mt-2 block text-slate-600">
              Outlook does not ask for a confirmation code.
            </span>
          </li>
        </Steps>
        <Notes>
          <li>
            Some work and school accounts block forwarding to outside addresses.
            If yours does, forward by hand.
          </li>
        </Notes>
      </Method>
      <Method
        id="icloud-steps"
        title="iCloud Mail"
        where="On a computer, at icloud.com/mail."
      >
        <Steps>
          <li>
            Open <Path items={["Settings", "Rules"]} />, then choose{" "}
            <Btn>Add a Rule</Btn>.
          </li>
          <li>
            Set the condition to a subject containing these words:
            <Paste>
              {SUBJECT_WORDS.map((word) => (
                <CopyField key={word} text={word} compact />
              ))}
            </Paste>
          </li>
          <li>
            Choose a forward action and enter this address:
            <Paste>
              <CopyField text={address} />
            </Paste>
            <span className="mt-2 block text-slate-600">
              If your rules don&rsquo;t offer forwarding, forward by hand
              instead.
            </span>
          </li>
        </Steps>
        <Notes>
          <li>
            Don&rsquo;t use iCloud&rsquo;s &ldquo;forward all my email&rdquo;
            option: it would send us everything, not just your orders.
          </li>
        </Notes>
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
