import type { Metadata } from "next";
import { connection } from "next/server";
import { LegalPage } from "@/components/legal-page";
import { RAW_EMAIL_DAYS, STALE_ORDER_DAYS } from "@/lib/email/cleanup";
import { getEnv } from "@/lib/env";
import { SERVICES } from "@/lib/legal/services";
import { KEEP_NOTIFICATIONS_DAYS } from "@/lib/notifications/maintenance";
import { ARCHIVE_AFTER_DAYS } from "@/lib/shipments/sync/archive-delivered";

export const metadata: Metadata = { title: "Privacy policy · Wayfind" };

/** Public. Rendered per request, since the contact address comes from the env. */
export default async function PrivacyPage() {
  await connection();
  const { SUPPORT_EMAIL, EXPIRE_AFTER_DAYS } = getEnv();

  return (
    <LegalPage title="Privacy policy" updated="October 9, 2026">
      <p>
        Wayfind tracks your packages. This page says what we keep about you,
        why, who else sees it, how long we keep it, and how to take it with you
        or delete it. Questions:{" "}
        <a className="text-link underline" href={`mailto:${SUPPORT_EMAIL}`}>
          {SUPPORT_EMAIL}
        </a>
        .
      </p>

      <h2>What we keep</h2>
      <ul>
        <li>
          Your account: your email address, and the private forwarding address
          we make for you.
        </li>
        <li>
          Your packages: tracking numbers, the names you give them, and the
          carrier&apos;s tracking events (status, time, place).
        </li>
        <li>
          Emails you forward to your Wayfind address: the email itself, and what
          we read from it (shop, item, order number, tracking numbers).
        </li>
        <li>
          Your alert settings, a history of the alerts we sent, and, for each
          device you turned push on for, its push address.
        </li>
        <li>
          Short-lived counters used to stop abuse (for example, how many sign-in
          links were asked for). Email addresses and IP addresses are stored
          only as one-way hashes.
        </li>
      </ul>
      <p>
        We use this only to run Wayfind for you. We don&apos;t sell it, show
        ads, or share it except with the services below.
      </p>

      <h2>Who else sees it</h2>
      <ul>
        {SERVICES.map((service) => (
          <li key={service.name}>
            <strong>{service.name}</strong> ({service.role}): {service.sees}
          </li>
        ))}
      </ul>

      <h2>How long we keep it</h2>
      <ul>
        <li>Forwarded emails: {RAW_EMAIL_DAYS} days, then deleted.</li>
        <li>Alert history: {KEEP_NOTIFICATIONS_DAYS} days.</li>
        <li>Orders that never shipped: {STALE_ORDER_DAYS} days.</li>
        <li>
          Packages: until you delete them or your account. A delivered package
          leaves your list {ARCHIVE_AFTER_DAYS} days after delivery, and one
          with no news for {EXPIRE_AFTER_DAYS} days is marked expired; both stay
          in your data until deleted.
        </li>
        <li>Your account: until you delete it.</li>
      </ul>

      <h2>On your device</h2>
      <p>
        If you install Wayfind or turn on push, your browser keeps a copy of
        your package list so it opens offline, and a push subscription. Signing
        out removes both from that device.
      </p>

      <h2>Your choices</h2>
      <ul>
        <li>
          <strong>Download your data</strong> at any time from Settings: one
          file with everything listed above.
        </li>
        <li>
          <strong>Delete your account</strong> from Settings. Your packages,
          orders, emails, alerts, settings and devices are deleted at once, then
          your sign-in. Copies in our database host&apos;s backups expire on
          their schedule.
        </li>
        <li>
          Turn alerts off, change quiet hours, or get a new forwarding address
          in Settings.
        </li>
      </ul>

      <h2>Changes</h2>
      <p>
        If this policy changes in a way that matters, we will tell you by email
        before it takes effect.
      </p>
    </LegalPage>
  );
}
