import { headers } from "next/headers";
import Link from "next/link";
import { ConfirmationWatcher } from "@/components/confirmation-watcher";
import { DeviceSetup } from "@/components/device-setup";
import {
  AddressUnavailable,
  PrivateAddressSection,
} from "@/components/forwarding-address";
import { LegalLinks } from "@/components/legal-page";
import { SetupStatus } from "@/components/setup-status";
import { SiteHeader } from "@/components/site-header";
import { requireUser } from "@/lib/auth/session";
import { getDb } from "@/lib/db/client";
import { latestGmailConfirmation } from "@/lib/db/inbound-emails";
import { getSetupAnswer, loadSetupSignals } from "@/lib/db/setup";
import { loadForwardingAddress } from "@/lib/email/forwarding-address";
import { deviceKind } from "@/lib/pwa/service-worker";
import { formatRelativeTime } from "@/lib/shipments/format";
import { DAY_MS, msBefore } from "@/lib/time";
import { completeSetupAction, skipSetupAction } from "../actions";
import { signOut } from "../sign-in/actions";
import { removePushSubscriptionAction } from "../settings/actions";

/** A Gmail code is only useful for a short while after it is sent. */
const CONFIRMATION_WINDOW_MS = 3 * DAY_MS;

export default async function SetupPage() {
  const user = await requireUser();
  const db = getDb();
  const now = new Date();

  const address = await loadForwardingAddress(db, user);

  const confirmation = await latestGmailConfirmation(
    db,
    user.id,
    msBefore(now, CONFIRMATION_WINDOW_MS),
  );

  const [answer, signals] = await Promise.all([
    getSetupAnswer(db, user.id),
    loadSetupSignals(db, user.id),
  ]);

  // The first paint already shows the steps for this device. The browser
  // checks again after load (it can tell an iPad posing as a Mac).
  const userAgent = (await headers()).get("user-agent") ?? "";

  const addressPanel = address ? (
    <>
      <PrivateAddressSection address={address}>
        <p className="text-sm text-slate-500">
          Need a new address? You can make one in{" "}
          <Link href="/settings" className="text-link underline">
            Settings
          </Link>
          .
        </p>
      </PrivateAddressSection>

      {!confirmation && <ConfirmationWatcher />}

      {confirmation && (
        <section
          aria-labelledby="confirmation-heading"
          className="space-y-2 rounded-card border border-brand-600 bg-brand-50 p-4"
        >
          <h3 id="confirmation-heading" className="font-semibold">
            Gmail confirmation
          </h3>
          {confirmation.link && (
            <p>
              <a
                href={confirmation.link}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-block rounded-full bg-brand-600 px-4 py-2 text-sm font-medium text-white hover:bg-brand-700"
              >
                Confirm in Gmail
              </a>
            </p>
          )}
          {confirmation.code && (
            <p className="font-mono text-2xl tracking-widest">
              {confirmation.code}
            </p>
          )}
          <p className="text-sm text-slate-600">
            {confirmation.link && confirmation.code
              ? "Open the link, or enter this code in Gmail, to finish adding the forwarding address."
              : confirmation.link
                ? "Open the link to finish adding the forwarding address. It goes to Google."
                : "Enter this code in Gmail to finish adding the forwarding address."}{" "}
            Received {formatRelativeTime(confirmation.receivedAt, now)}.
          </p>
        </section>
      )}
    </>
  ) : (
    <AddressUnavailable />
  );

  return (
    <>
      <SiteHeader
        email={user.email}
        signOutAction={signOut}
        removeDeviceAction={removePushSubscriptionAction}
        current="setup"
      />
      <main className="mx-auto max-w-3xl space-y-6 px-4 py-8">
        <Link href="/" className="text-sm text-link hover:underline">
          ← Back to packages
        </Link>
        <div className="space-y-1">
          <h1 className="text-2xl font-semibold">Set up Wayfind</h1>
          <p className="text-sm text-slate-600">
            Three steps: send your order emails here, put Wayfind on your
            device, and choose how you hear about changes.
          </p>
        </div>

        <SetupStatus
          answer={answer ?? { completedAt: null, skippedAt: null }}
          emailsArriving={signals.emailsArriving}
          pushDevices={signals.pushDevices}
          completeAction={completeSetupAction}
          skipAction={skipSetupAction}
        />

        <DeviceSetup
          address={address}
          initialDevice={deviceKind({ userAgent })}
          addressPanel={addressPanel}
        />

        <footer className="border-t border-slate-200 pt-4">
          <LegalLinks />
        </footer>
      </main>
    </>
  );
}
