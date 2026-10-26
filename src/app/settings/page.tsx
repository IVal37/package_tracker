import Link from "next/link";
import { LegalLinks } from "@/components/legal-page";
import { DeleteAccount } from "@/components/delete-account";
import { FailedEmails } from "@/components/failed-emails";
import { ForwardingAddress } from "@/components/forwarding-address";
import { NotificationSettingsForm } from "@/components/notification-settings-form";
import { PushDeviceManager } from "@/components/push-device-manager";
import { SiteHeader } from "@/components/site-header";
import { ThemeSwitcher } from "@/components/theme-switcher";
import { requireLiveAccount } from "@/lib/auth/account";
import { requireUser } from "@/lib/auth/session";
import { getDb } from "@/lib/db/client";
import { getOrCreateAlias } from "@/lib/db/forwarding";
import { countFailedEmails, listFailedEmails } from "@/lib/db/inbound-emails";
import { getNotificationPrefs } from "@/lib/db/notification-settings";
import { formatAddress } from "@/lib/email/alias";
import { failureReason } from "@/lib/email/failed";
import { getEnv } from "@/lib/env";
import { formatRelativeTime } from "@/lib/shipments/format";
import { signOut } from "../sign-in/actions";
import {
  deleteAccountAction,
  dismissEmailAction,
  regenerateAddressAction,
  retryEmailAction,
  removePushSubscriptionAction,
  saveNotificationSettingsAction,
  savePushSubscriptionAction,
  sendTestPushAction,
} from "./actions";

export default async function SettingsPage() {
  const user = await requireUser();
  const db = getDb();
  const now = new Date();

  // The alias hangs off the user row. If the account was deleted on another
  // device, this session is signed out rather than given a new row.
  await requireLiveAccount(db, user);
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

  const [prefs, failed, failedEmails] = await Promise.all([
    getNotificationPrefs(db, user.id),
    countFailedEmails(db, user.id),
    listFailedEmails(db, user.id, 20),
  ]);

  return (
    <>
      <SiteHeader
        email={user.email}
        signOutAction={signOut}
        removeDeviceAction={removePushSubscriptionAction}
        current="settings"
      />
      <main className="mx-auto max-w-3xl space-y-8 px-4 py-8">
        <Link href="/" className="text-sm text-link hover:underline">
          ← Back to packages
        </Link>

        <h2 className="text-lg font-semibold">Appearance</h2>
        <ThemeSwitcher />

        <h2 className="text-lg font-semibold">Notifications</h2>
        <PushDeviceManager
          publicKey={vapidPublicKey}
          saveAction={savePushSubscriptionAction}
          removeAction={removePushSubscriptionAction}
          testAction={sendTestPushAction}
        />
        <section
          aria-labelledby="alerts-heading"
          className="space-y-3 rounded-lg border border-slate-200 bg-surface p-4"
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

        <h2 className="text-lg font-semibold">Email forwarding</h2>

        {address ? (
          <>
            <section
              aria-labelledby="address-heading"
              className="space-y-3 rounded-lg border border-slate-200 bg-surface p-4"
            >
              <h3 id="address-heading" className="font-semibold">
                Your private address
              </h3>
              <p className="text-sm text-slate-600">
                Forward order and shipping emails here and the packages appear
                in your list. Keep this address to yourself: anyone who has it
                can add packages to your account.
              </p>
              <ForwardingAddress
                address={address}
                regenerateAction={regenerateAddressAction}
              />
              <p className="text-sm text-slate-600">
                <Link href="/setup" className="text-link hover:underline">
                  How to set up forwarding →
                </Link>
              </p>
            </section>
          </>
        ) : (
          <p className="text-sm text-slate-600">
            Your forwarding address could not be created. Reload the page to try
            again.
          </p>
        )}

        <FailedEmails
          total={failed}
          emails={failedEmails.map((email) => ({
            id: email.id,
            from: email.fromAddress,
            subject: email.subject,
            received: formatRelativeTime(email.receivedAt, now),
            reason: failureReason(email.error),
          }))}
          retryAction={retryEmailAction}
          dismissAction={dismissEmailAction}
        />

        <h2 className="text-lg font-semibold">Your data</h2>
        <section
          aria-labelledby="export-heading"
          className="space-y-2 rounded-lg border border-slate-200 bg-surface p-4"
        >
          <h3 id="export-heading" className="font-semibold">
            Download my data
          </h3>
          <p className="text-sm text-slate-600">
            One file with your account, packages, orders, forwarded emails we
            still keep, alert settings and history.
          </p>
          <a
            href="/settings/export"
            download
            className="inline-block rounded-md border border-slate-300 px-3 py-1.5 text-sm font-medium hover:bg-slate-50"
          >
            Download my data
          </a>
        </section>
        <section
          aria-labelledby="delete-heading"
          className="space-y-2 rounded-lg border border-red-200 bg-surface p-4"
        >
          <h3 id="delete-heading" className="font-semibold">
            Delete my account
          </h3>
          <DeleteAccount action={deleteAccountAction} />
        </section>
        <footer className="border-t border-slate-200 pt-4">
          <LegalLinks />
        </footer>
      </main>
    </>
  );
}
