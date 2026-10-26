import { CopyButton } from "./copy-button";
import { RegenerateAddress } from "./regenerate-address";

interface ForwardingAddressProps {
  address: string;
  /** Only Settings passes this; the address is replaced there, not on Setup. */
  regenerateAction?: (formData: FormData) => Promise<void>;
}

/** The private forwarding address with Copy, and Regenerate where it is allowed. */
export function ForwardingAddress({
  address,
  regenerateAction,
}: ForwardingAddressProps) {
  return (
    <>
      <div className="flex flex-wrap items-center gap-3">
        <code className="break-all rounded bg-slate-100 px-2 py-1 text-sm">
          {address}
        </code>
        <CopyButton text={address} />
      </div>
      {regenerateAction && <RegenerateAddress action={regenerateAction} />}
    </>
  );
}
