import { notFound } from "next/navigation";
import { isAdmin, loadAdminStats } from "@/lib/admin";
import { getCurrentUser } from "@/lib/auth/session";
import { getDb } from "@/lib/db/client";
import { getEnv } from "@/lib/env";
import { formatRelativeTime } from "@/lib/shipments/format";

/**
 * Tracker usage against the Ship24 allowance, and the health of the
 * background work. Only for the emails in ADMIN_EMAILS: to anyone else,
 * signed in or not, it does not exist. Counts only, never anyone's packages.
 */
export default async function AdminPage() {
  const user = await getCurrentUser();
  const env = getEnv();
  if (!user || !isAdmin(user.email, env.ADMIN_EMAILS)) notFound();

  const now = new Date();
  const stats = await loadAdminStats({
    db: getDb(),
    provider: env.TRACKING_PROVIDER,
    allowance: env.SHIP24_MONTHLY_ALLOWANCE ?? null,
    now,
  });
  const highest = Math.max(1, ...stats.trackersPerDay.map((d) => d.count));
  const share =
    stats.allowance === null
      ? null
      : Math.round((stats.monthSoFar / stats.allowance) * 100);

  const facts: [string, string][] = [
    ["Users", String(stats.users)],
    ["Active packages", String(stats.activeShipments)],
    ["Emails that failed (7 days)", String(stats.failedEmails)],
    ["Alerts that failed (7 days)", String(stats.failedNotifications)],
    [
      "Oldest email waiting to be read",
      stats.oldestPendingEmail
        ? formatRelativeTime(stats.oldestPendingEmail, now)
        : "None",
    ],
    [
      "Oldest alert waiting to be sent",
      stats.oldestPendingNotification
        ? formatRelativeTime(stats.oldestPendingNotification, now)
        : "None",
    ],
  ];

  return (
    <main className="mx-auto max-w-3xl space-y-8 px-4 py-8">
      <h1 className="text-xl font-semibold">Admin</h1>

      <section aria-labelledby="usage-heading" className="space-y-3">
        <h2 id="usage-heading" className="text-lg font-semibold">
          Trackers ({stats.provider})
        </h2>
        <p className="text-sm text-slate-700">
          This month so far: <strong>{stats.monthSoFar}</strong>
          {stats.allowance === null ? (
            <> of an allowance that is not set (SHIP24_MONTHLY_ALLOWANCE).</>
          ) : (
            <>
              {" "}
              of {stats.allowance} ({share}%).
            </>
          )}
        </p>
        <p className="text-xs text-slate-500">
          A tracker shared by several users counts once. Counted from the
          packages still stored, so deleted ones are missing: Ship24&apos;s own
          dashboard is the source of truth for billing.
        </p>
        <table className="w-full text-sm">
          <caption className="sr-only">Trackers first used per day</caption>
          <thead>
            <tr className="text-left text-slate-500">
              <th scope="col" className="py-1 font-normal">
                Day (UTC)
              </th>
              <th scope="col" className="py-1 font-normal">
                Trackers
              </th>
            </tr>
          </thead>
          <tbody>
            {stats.trackersPerDay.map((row) => (
              <tr key={row.day} className="border-t border-slate-100">
                <td className="py-1 tabular-nums">{row.day}</td>
                <td className="py-1">
                  <div className="flex items-center gap-2">
                    <span className="w-8 text-right tabular-nums">
                      {row.count}
                    </span>
                    <span
                      aria-hidden
                      className="h-2 rounded bg-brand-600"
                      style={{ width: `${(row.count / highest) * 60}%` }}
                    />
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>

      <section aria-labelledby="health-heading" className="space-y-3">
        <h2 id="health-heading" className="text-lg font-semibold">
          Health
        </h2>
        <dl className="grid grid-cols-[1fr_auto] gap-x-4 gap-y-1 text-sm">
          {facts.map(([label, value]) => (
            <div key={label} className="contents">
              <dt className="text-slate-600">{label}</dt>
              <dd className="text-right tabular-nums">{value}</dd>
            </div>
          ))}
        </dl>
      </section>
    </main>
  );
}
