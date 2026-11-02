import { CopyButton } from "./copy-button";
import { RegenerateAddress } from "./regenerate-address";

interface ForwardingAddressProps {
  address: string;
  /** Only Settings passes this; the address is replaced there, not on Setup. */
  regenerateAction?: (formData: FormData) => Promise<void>;
}

/** The card around the address on Settings and Setup; `children` end it. */
export function PrivateAddressSection({
  address,
  regenerateAction,
  children,
}: ForwardingAddressProps & { children: React.ReactNode }) {
  return (
    <section
      aria-labelledby="address-heading"
      className="space-y-3 rounded-card glass-card p-4"
    >
      <h3 id="address-heading" className="font-semibold">
        Your private address
      </h3>
      <p className="text-sm text-slate-600">
        Forward order and shipping emails here and the packages appear in your
        list. Keep this address to yourself: anyone who has it can add packages
        to your account.
      </p>
      <ForwardingAddress
        address={address}
        regenerateAction={regenerateAction}
      />
      {children}
    </section>
  );
}

/** Shown in place of the card when no alias could be made. */
export function AddressUnavailable() {
  return (
    <p className="text-sm text-slate-600">
      Your forwarding address could not be created. Reload the page to try
      again.
    </p>
  );
}

/** The private forwarding address with Copy, and Regenerate where it is allowed. */
export function ForwardingAddress({
  address,
  regenerateAction,
}: ForwardingAddressProps) {
  return (
    <>
      <div className="flex flex-wrap items-center gap-3">
        <code className="break-all rounded-lg bg-slate-100 px-2 py-1 text-sm">
          {address}
        </code>
        <CopyButton text={address} />
      </div>
      {regenerateAction && <RegenerateAddress action={regenerateAction} />}
    </>
  );
}
