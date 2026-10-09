import Link from "next/link";
import { CopyButton } from "@/components/copy-button";
import { ForwardingInstructions } from "@/components/forwarding-instructions";
import { InstallCard } from "@/components/install-card";
import { NotificationSettingsForm } from "@/components/notification-settings-form";
import { PushDeviceManager } from "@/components/push-device-manager";
import { RegenerateAddress } from "@/components/regenerate-address";
import { SiteHeader } from "@/components/site-header";
import { requireUser } from "@/lib/auth/session";
import { getDb } from "@/lib/db/client";
import { getOrCreateAlias } from "@/lib/db/forwarding";
import {
  countFailedEmails,
  latestGmailConfirmation,
} from "@/lib/db/inbound-emails";
import { getNotificationPrefs } from "@/lib/db/notification-settings";
import { ensureUser } from "@/lib/db/users";
import { formatAddress } from "@/lib/email/alias";
import { getEnv } from "@/lib/env";
import { formatRelativeTime } from "@/lib/shipments/format";
import { signOut } from "../sign-in/actions";
import {
  regenerateAddressAction,
  removePushSubscriptionAction,
  saveNotificationSettingsAction,
  savePushSubscriptionAction,
  sendTestPushAction,
} from "./actions";

/** A Gmail code is only useful for a short while after it is sent. */
const CONFIRMATION_WINDOW_MS = 3 * 86_400_000;

export default async function SettingsPage() {
  const user = await requireUser();
  const db = getDb();
  const now = new Date();

  // The alias hangs off the user row, so make sure there is one.
  await ensureUser(db, user);
  const alias = await getOrCreateAlias(db, user.id);
  const address = alias
    ? formatAddress(alias, getEnv().INBOUND_EMAIL_DOMAIN)
    : null;

  const env = getEnv();
  // The browser needs the public half of the VAPID key to subscribe; with the
  // fake sender there is no key and the push section says so.
  const vapidPublicKey =
    env.PUSH_SENDER === "webpush" ? (env.VAPID_PUBLIC_KEY ?? null) : null;
  const timeZones = Intl.supportedValuesOf("timeZone");

  const [prefs, confirmation, failed] = await Promise.all([
    getNotificationPrefs(db, user.id),
    latestGmailConfirmation(
      db,
      user.id,
      new Date(now.getTime() - CONFIRMATION_WINDOW_MS),
    ),
    countFailedEmails(db, user.id),
  ]);

  return (
    <>
      <SiteHeader
        email={user.email}
        signOutAction={signOut}
        removeDeviceAction={removePushSubscriptionAction}
      />
      <main className="mx-auto max-w-3xl space-y-8 px-4 py-8">
        <Link href="/" className="text-sm text-brand-700 hover:underline">
          ← Back to packages
        </Link>

        <h2 className="text-lg font-semibold">Notifications</h2>
        <PushDeviceManager
          publicKey={vapidPublicKey}
          saveAction={savePushSubscriptionAction}
          removeAction={removePushSubscriptionAction}
          testAction={sendTestPushAction}
        />
        <section
          aria-labelledby="alerts-heading"
          className="space-y-3 rounded-lg border border-slate-200 bg-white p-4"
        >
          <h3 id="alerts-heading" className="font-semibold">
            Which alerts you get
          </h3>
          <NotificationSettingsForm
            prefs={prefs}
            suggestBrowserZone={prefs.quiet.timeZone === "UTC"}
            timeZones={timeZones}
            action={saveNotificationSettingsAction}
          />
        </section>
        <InstallCard />

        <h2 className="text-lg font-semibold">Email forwarding</h2>

        {address ? (
          <>
            <section
              aria-labelledby="address-heading"
              className="space-y-3 rounded-lg border border-slate-200 bg-white p-4"
            >
              <h3 id="address-heading" className="font-semibold">
                Your private address
              </h3>
              <p className="text-sm text-slate-600">
                Forward order and shipping emails here and the packages appear
                in your list. Keep this address to yourself: anyone who has it
                can add packages to your account.
              </p>
              <div className="flex flex-wrap items-center gap-3">
                <code className="break-all rounded bg-slate-100 px-2 py-1 text-sm">
                  {address}
                </code>
                <CopyButton text={address} />
              </div>
              <RegenerateAddress action={regenerateAddressAction} />
            </section>

            {confirmation && (
              <section
                aria-labelledby="confirmation-heading"
                className="space-y-2 rounded-lg border border-brand-600 bg-brand-50 p-4"
              >
                <h3 id="confirmation-heading" className="font-semibold">
                  Gmail confirmation code
                </h3>
                <p className="font-mono text-2xl tracking-widest">
                  {confirmation.code}
                </p>
                <p className="text-sm text-slate-600">
                  Enter this code in Gmail to finish adding the forwarding
                  address. Received{" "}
                  {formatRelativeTime(confirmation.receivedAt, now)}.
                </p>
              </section>
            )}

            <ForwardingInstructions address={address} />
          </>
        ) : (
          <p className="text-sm text-slate-600">
            Your forwarding address could not be created. Reload the page to try
            again.
          </p>
        )}

        {failed > 0 && (
          <p
            role="status"
            className="rounded-lg border border-amber-300 bg-amber-50 p-4 text-sm"
          >
            {failed === 1
              ? "1 forwarded email couldn't be read."
              : `${failed} forwarded emails couldn't be read.`}{" "}
            Add those packages by hand with their tracking numbers.
          </p>
        )}
      </main>
    </>
  );
}
