# Launch audit

Written 2026-10-09 at the start of Phase 7, before any Phase 7 code. Sources: a `code-review` pass over all of `src/` (no diff, so the whole tree) and a manual security pass over the attack surface: the two webhooks, `/api/inngest`, sign-in, server actions, push endpoints, the service worker, logging and the environment rules. The `security-review` skill could not run: it only reviews a diff against `origin/HEAD`, and there was no diff.

Rule (from `docs/phase-7-plan.md`): every **High** and **Medium** item is fixed before the `mvp-launch` tag, in the step named, and ticked here with the commit. **Low** items go to the final sweep (`docs/unresolved-issues.md`).

## High

| ID | Where | Finding | Fix | Done |
| --- | --- | --- | --- | --- |
| H1 | `src/lib/shipments/delete-shipment.ts:26` | Deleting a package always unsubscribes the provider tracker, but one tracker can be shared by several users' shipments (same tracking number). User A's delete stops webhooks, and so alerts, for user B, whose package then moves only on the 24-hour re-fetch. | Step 5: unsubscribe only when no other shipment uses the tracker. Account deletion (step 11) follows the same rule. | [ ] |
| H2 | `src/app/sign-in/actions.ts`, `src/app/actions.ts`, `src/app/api/webhooks/inbound-email/route.ts` | No rate limiting anywhere public. Anyone can make the app send unlimited magic-link emails to any address (Supabase mail quota, sender reputation, harassment), and a signed-in user can add packages as fast as they can post. | Step 4: database-backed limits on sign-in (per IP and per email), adding packages, test push, the inbound webhook, export and delete. | [ ] |
| H3 | `src/lib/shipments/add-shipment.ts` | No per-user package cap. One account, or anyone who learns a forwarding alias, can create trackers until the Ship24 plan's allowance is gone for everybody. | Step 5: active-package cap (25 by default), checked before the provider is called. | [ ] |

## Medium

| ID | Where | Finding | Fix | Done |
| --- | --- | --- | --- | --- |
| M1 | `src/jobs/notifications.ts:148`, `src/lib/notifications/events.ts:36` | The hourly sweep re-queues every pending alert with a new event id each hour, including alerts whose run is asleep waiting out quiet hours. When quiet hours end, every one of those runs wakes and delivers the push (the status only changes at the end of a run, and the concurrency key serialises steps, not runs). The device can buzz up to about 9 times; email is saved only by Resend's idempotency key. `docs/unresolved-issues.md` called this harmless; it is not. | Step 15: `singleton: { mode: "skip", key: event.data.notificationId }` on `send-notification`, so a re-queued alert is dropped while its run is alive. | [ ] |
| M2 | `src/lib/db/notify-sync.ts:119` | `hasNewerNotification` counts newer alerts that were already **skipped** (for example a `delay` alert the user switched off). An alert the user wants, held by quiet hours, is then dropped as `superseded` by one that was never delivered. | Step 15: only a newer alert that was not skipped supersedes. | [ ] |
| M3 | `src/lib/tracking/ship24/provider.ts:100` | When a tracker already exists, `createTracking` reads it but never subscribes it again. A number whose tracker was unsubscribed by a delete gets no webhooks when it is added again, by anyone. H1's fix makes this rarer but the last follower deleting and re-adding still hits it. | Step 15: on a conflict, set `isSubscribed: true` on the tracker found (best effort; the re-fetch is the backstop). | [ ] |
| M4 | `src/lib/db/users.ts:16`, `src/lib/db/schema.ts:61` | `ensureUser` upserts on `id`, but `users.email` is also unique. A sign-in account recreated with the same email (new Supabase id; for example deleted in the Supabase dashboard) fails on every sign-in and every page that calls `ensureUser`, for good. Nothing looks a user up by email, so the constraint protects nothing. | Step 2 (schema commit): drop the unique constraint on `users.email`. | [ ] |
| M5 | `src/components/push-device-manager.tsx:64` | Settings shows "Push is on for this device" whenever the browser has any subscription, without saving it for the signed-in user. After a session expires without a sign-out, the next person on that browser sees "on" while the subscription still belongs to the previous account, whose package alerts keep arriving on this device. | Step 15: when Settings finds an existing subscription it saves it again for the current user (the server already moves an endpoint to its new owner). | [ ] |
| M6 | `src/app/api/inngest/route.ts`, `src/lib/env.ts` | `INNGEST_DEV=1` makes the Inngest SDK skip request signing. Set by mistake in production (say, copied from `.env.local`), anyone could call `/api/inngest` and start function runs. | Step 3: the env schema refuses `INNGEST_DEV` in production. | [ ] |
| M7 | everywhere | No error reporting: a job out of retries, a failed alert or a re-fetch stopped by a bad key is visible only in the Inngest dashboard. | Step 8: Sentry with personal data stripped, plus `onFailure` reports. | [ ] |
| M8 | `next.config.ts` | No security headers on pages: no HSTS, no `nosniff`, no frame protection (clickjacking of the delete and settings forms), no CSP. | Step 13. | [ ] |
| M9 | `src/jobs/refetch-stale.ts` | The re-fetch runs up to 100 provider calls one after another in a single step, which can pass a serverless time limit; a bad key or exhausted quota only shows as `stoppedEarly` in the run output. | Step 7 (fan-out) and step 8 (report). | [ ] |
| M10 | `src/lib/db/tracker-sync.ts` | `Expired` is never set, so dead trackers are re-fetched every day for ever and stay in the list. | Step 6. | [ ] |
| M11 | `src/app/settings/page.tsx:150` | Emails that could not be read show only as a count; the user cannot see which, retry or clear them. | Step 9. | [ ] |
| M12 | n/a | No way to download or delete your data, and no privacy policy or terms. Personal data (email, purchases, forwarded emails with addresses) is stored. | Steps 11 and 12. | [ ] |
| M13 | Supabase dashboard | Magic links go through Supabase's built-in mailer, which is limited to a handful of emails an hour and is for development only. Sign-up would fail for most people on launch day. | Step 15: custom SMTP (Resend) in `docs/launch-checklist.md`. | [ ] |
| M14 | production | Nothing has run against the real services yet: a Ship24 webhook, Inngest app sync and crons, the Cloudflare Worker, Resend, real push. | Step 15: `docs/launch-checklist.md`, then your deploy. | [ ] |

## Low (final sweep)

| ID | Where | Finding |
| --- | --- | --- |
| L1 | `src/lib/shipments/add-shipment.ts:47` | The duplicate check also matches **archived** shipments, so a tracking number that was delivered and archived can never be added again ("You're already tracking this package", and nothing appears). Rare: couriers seldom reuse numbers within months. |
| L2 | `src/lib/shipments/format.ts:28` | `formatEta` ignores the status, so a Delivered package whose ETA date has passed shows "Overdue" for the 14 days it stays listed. Cosmetic. |
| L3 | `src/lib/email/process.ts:185` | "Strong" carrier-format numbers are scanned over the raw HTML too and added without the model's judgement; a DHL logo followed by a 10-digit phone number can become a junk tracker. Bounded by the cap and the add limit; tune with real emails (`npm run eval:email`). |
| L4 | `src/jobs/geocode.ts:65`, `src/lib/db/geo-sync.ts` | A permanent geocoder error caches nothing, so the place is queued again every day once the 24-hour event-id dedupe lapses. `findPendingPlaces` has no `ORDER BY`, so enough such keys could crowd new places out of a sweep. |
| L5 | both webhook routes | The body is read in full before the secret is checked. Bounded by the platform's request-size limit (4.5 MB on Vercel); the firewall rate limit (step 15 checklist) covers floods. |
| L6 | `src/jobs/inbound-email.ts` | The hourly sweep can re-queue an email whose run is waiting to retry, so the model may be asked twice about one email (the second result is discarded, since only a pending email is finished). Costs a fraction of a cent. |
| L7 | `tests/lint-guards.test.ts` | Under the full parallel run on Windows one lint-guard case occasionally fails (the same file passes alone). Probably ESLint starting slowly under load. |
