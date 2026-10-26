import type { Metadata } from "next";
import Link from "next/link";
import { connection } from "next/server";
import { LegalPage } from "@/components/legal-page";
import { getEnv } from "@/lib/env";

export const metadata: Metadata = { title: "Terms · Wayfind" };

/** Public. Rendered per request, since the contact address comes from the env. */
export default async function TermsPage() {
  await connection();
  const { SUPPORT_EMAIL, ACTIVE_PACKAGE_CAP } = getEnv();

  return (
    <LegalPage title="Terms of use" updated="October 9, 2026">
      <p>
        By using Wayfind you agree to these terms. If you don&apos;t, please
        don&apos;t use it. Questions:{" "}
        <a className="text-link underline" href={`mailto:${SUPPORT_EMAIL}`}>
          {SUPPORT_EMAIL}
        </a>
        .
      </p>

      <h2>What Wayfind is</h2>
      <p>
        Wayfind shows where your packages are, using what carriers report
        through our tracking provider. We don&apos;t carry packages and
        can&apos;t change a delivery. Tracking data, delivery estimates, map
        positions and alerts can be late, wrong or missing; check with the
        carrier or shop for anything that matters.
      </p>

      <h2>Your account</h2>
      <ul>
        <li>Keep your sign-in and your forwarding address to yourself.</li>
        <li>
          Only add packages and forward emails that are yours to track, and only
          forward emails you are allowed to share with us.
        </li>
        <li>
          You can follow up to {ACTIVE_PACKAGE_CAP} packages at once, and adding
          and email forwarding have fair-use limits.
        </li>
      </ul>

      <h2>Don&apos;t</h2>
      <ul>
        <li>Use Wayfind to track people or packages that aren&apos;t yours.</li>
        <li>
          Try to break, overload, scrape or get around the limits of the
          service, or reach other people&apos;s data.
        </li>
        <li>Send us malware or anything unlawful.</li>
      </ul>
      <p>We may suspend or close accounts that do.</p>

      <h2>The service</h2>
      <p>
        Wayfind is free for now and provided as it is, without warranties. We
        may change or stop features, and we will give notice before shutting
        down. To the extent the law allows, we are not liable for indirect
        losses or for missed or late deliveries.
      </p>

      <h2>Your data</h2>
      <p>
        You own your data. How we handle it is in the{" "}
        <Link className="text-link underline" href="/privacy">
          privacy policy
        </Link>
        . You can download it or delete your account at any time in Settings.
      </p>

      <h2>Changes</h2>
      <p>
        If these terms change in a way that matters, we will tell you by email
        before they take effect.
      </p>
    </LegalPage>
  );
}
