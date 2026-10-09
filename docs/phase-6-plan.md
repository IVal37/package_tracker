# Phase 6 — Notifications and installable PWA: plan

Decisions (2026-10-08):

- **Alerts:** four kinds.
  - **Out for delivery.**
  - **Delivered:** also covers Ready for pickup.
  - **Problem:** Exception and Delivery attempted.
  - **Delay:** the carrier moves the ETA to a later day, or the ETA passes by 24 hours without delivery.
- **Defaults:** push on for all four (once a device is enabled); email on for Delivered and Problem only.
- **Quiet hours:** they hold both push and email until they end. Off by default; the form suggests 22:00–07:00.
- **Senders:** web push via `web-push` (VAPID); email via Resend's REST API with `fetch`, so no SDK.

## Goal

A user hears about the moments that matter (out for delivery, delivered or ready, a problem, a delay) by push on their devices and by email. Each alert arrives exactly once, respects their settings and quiet hours, and is sent only from background jobs. The app installs to the home screen and shows the last-seen list when offline.

## Facts that shape this design

Read 2026-10-08 (the Next.js PWA guide bundled in `node_modules/next/dist/docs/01-app/02-guides/progressive-web-apps.md`, plus what I know of the services). Re-check the starred items when building.

- **Every status change goes through one function.** That is `applyTrackerUpdate` in `src/lib/db/tracker-sync.ts`, used by the webhook and the re-fetch job. It locks the shipment rows and calls `decideShipmentUpdate`, so a late older event never changes status. That is the single, transactional place to detect alerts.
- **Shipments added by hand or from email never alert at creation.** The user is looking at them, or just forwarded the email.
- **Web push** works in Chromium, Firefox and Safari 16+ on macOS 13+. **On iPhone and iPad it works only for an app installed to the home screen (iOS 16.4+).** Next's guide uses the `web-push` package and a hand-written service worker. It recommends a `/sw.js` served with `Cache-Control: no-cache` and a strict CSP. Local push testing needs `next dev --experimental-https`.
- **`beforeinstallprompt`** exists only in Chromium. iOS needs "Share → Add to Home Screen" instructions.
- **Resend:** `POST https://api.resend.com/emails` with a Bearer key.
  - ★ The free plan is about 3,000 emails a month and 100 a day.
  - ★ An `Idempotency-Key` header de-duplicates retries.
  - **Sending to anyone but your own account needs a verified domain.** You have none yet, so email uses a fake sender locally and the live check waits for a domain, as with Phase 5.
- **Inngest** has `step.sleepUntil`. A notification held by quiet hours can sleep until they end, so no frequent polling cron is needed. ★ Check the free plan's sleep limit (it was 7 days).
- **Next 16 metadata routes:** `app/manifest.ts` generates the manifest. App icons can be PNGs rendered by `ImageResponse` (`next/og`), so no image files or new packages are needed.
- **The proxy matcher** skips static assets by extension. `/sw.js`, the manifest and the icon routes must skip the sign-in redirect.

## Dependencies to approve

| Package | Where | Why |
| --- | --- | --- |
| `web-push` | app | VAPID signing and payload encryption (RFC 8291). Hand-rolling this crypto isn't worth the risk. |
| `@types/web-push` (dev) | app | Types |

Resend is called with plain `fetch` + zod, so it needs no package. Approving this plan approves these two and nothing else.

## Design decisions

### Alert rules (pure, `src/lib/notifications/rules.ts`)

- `alertsForUpdate(before, after)` compares the stored state with what `decideShipmentUpdate` returned. It fires only when the status or ETA actually changes; a no-op redelivery fires nothing.
- Each alert row has a key that fixes "once per event":

  | Kind | Fires when | Key |
  | --- | --- | --- |
  | `out_for_delivery` | status becomes `OutForDelivery` | the newest event time |
  | `delivered` | status becomes `Delivered` or `AvailableForPickup` | the status plus the newest event time |
  | `problem` | status becomes `Exception` or `AttemptFail` | the status plus the newest event time |
  | `delay` | the ETA moves to a later UTC calendar day, before delivery | `eta:<new ETA date>` |
  | `delay` | the ETA is more than 24 h past, the shipment isn't Delivered, Expired or archived (hourly job) | `overdue:<ETA date>` |

- Out for delivery on Monday, attempted, then out for delivery again on Tuesday gives three alerts, one per event.
- Archived shipments never alert.

### Storage (own migration)

- **`notifications`** table:
  - Columns: `id`, `user_id`, `shipment_id` (cascade), `kind` (enum), `dedupe_key`, `status` (`pending` | `sent` | `skipped` | `failed`), `skip_reason`, `push_sent`, `email_sent`, `created_at`, `sent_at`.
  - Unique on `(shipment_id, kind, dedupe_key)`. Rows are inserted with `on conflict do nothing` inside the `applyTrackerUpdate` transaction. Concurrent or repeated updates can't double-insert, and a failed update inserts nothing.
  - A partial index covers pending rows for the sweep.
- **`notification_settings`** table, one row per user, created on first save:
  - Eight booleans: push or email × the four kinds.
  - `quiet_enabled`, `quiet_start` and `quiet_end` (minutes after midnight), and `time_zone` (IANA, validated with `Intl`).
  - No row means the defaults above.
- **`push_subscriptions`** table: `id`, `user_id`, `endpoint` (unique), `p256dh`, `auth`, `created_at`, `last_success_at`.
  - Subscribing upserts on `endpoint`, so a browser that signs in as someone else moves to that user. One device never gets two users' alerts.
  - A 404 or 410 from the push service deletes the row.
- RLS is enabled with no policies on all three, as on every table.
- A daily job deletes `notifications` rows older than 90 days.

### Sending, from jobs only

1. `applyTrackerUpdate` returns the new notification ids, ids only, alongside its counts. The webhook route and the re-fetch job then send `notifications/created` events, one per id, using the existing best-effort `sendBestEffort` pattern in `src/jobs/events.ts`. Event id `notification-<id>` makes a repeat harmless.
2. Inngest function `send-notification` (concurrency 1 per id, retries 4):
   1. **Load:** load the row through system-scope `notify-sync.ts`, then read everything else user-scoped with that row's `user_id`: settings, shipment (`getShipment`), subscriptions and email.
   2. **Skip** with a reason when:
      - the row isn't pending;
      - the shipment is gone or archived;
      - a newer alert exists for that shipment (an "out for delivery" held overnight is dropped once "delivered" exists);
      - it's more than 24 h old;
      - both channels are off for that kind.
   3. **Quiet hours:** if inside them, `step.sleepUntil(end)`, then re-read the settings and re-check (at most twice). Windows that wrap midnight (22:00–07:00) and DST are handled by a pure `quietHoursEnd(now, settings)`.
   4. **Send:** `step.run("push")` and `step.run("email")` are separate steps, so a retry of email never re-sends push. Push goes to every subscription; dead ones are deleted. Email carries `Idempotency-Key: <notification id>`.
   5. **Mark** the row sent, with per-channel flags.

   A 429 or 5xx throws (retry). Running out of retries marks the row `failed`. Logs hold ids, kinds and counts only.
3. **Hourly cron `notifications-sweep`:**
   - re-sends events for pending rows older than 10 minutes, as a backstop for a lost send (a sleeping run ignores the duplicate id);
   - runs the overdue-delay check over a new partial index on `shipments(eta)` for non-terminal, non-archived rows.
4. **Senders:** a `PushSender` and an `EmailSender` interface, each with `fake` (default; records calls, no network) and real adapters (`webpush`, `resend`). They are chosen by env, like the extractor. ESLint keeps specific senders inside `src/lib/notifications/`.

### Message content

- **Title:** e.g. "Out for delivery: Merino running socks".
- **Body:** the last checkpoint message and place.
- **Link:** `APP_URL/?shipment=<id>`.
- **Names may come from a forwarded email (untrusted):**
  - Push and email text parts are plain text.
  - The email HTML escapes every value (`escapeHtml`, tested with `<script>`).
  - URLs are built from our own origin and a UUID only.
- No street address or tracking number appears in a push title (lock screens); the tracking number may appear in the email body.

### Settings UI (`/settings`, new "Notifications" section above "Email forwarding")

- **"Push on this device":**
  - Enable or disable, plus "Send a test".
  - States: unsupported, permission denied, and an iOS hint ("Install Wayfind to your Home Screen first").
  - Permission is asked only on that button click.
  - The VAPID public key is passed as a prop from the server component, so there is no `NEXT_PUBLIC_*`.
- **Alerts:** a 4 × 2 grid of checkboxes (alert × push/email).
- **Quiet hours:** a toggle, start and end times, and the time zone (auto-filled from the browser, editable).
- **"Install app":** Chromium uses `beforeinstallprompt`; iOS gets Share → Add to Home Screen steps; hidden when already standalone.
- **Server actions** (`app/settings/actions.ts`): `saveNotificationSettings` (zod-validated), `savePushSubscription`, `removePushSubscription` and `sendTestPush`.
  - Each takes the user only from `requireUser()`.
  - `sendTestPush` is limited to 3 a minute, in memory.

### PWA

- **`app/manifest.ts`:**
  - name, short name, `start_url: "/"`, `display: "standalone"`;
  - brand theme and background colours;
  - icons: 192, 512, a maskable 512 and an Apple touch icon, all `ImageResponse` routes with the Wayfind mark. Layout metadata links them.
- **`public/sw.js`:** hand-written plain JavaScript, committed and kept small.
  - Push: `push` shows the notification; `notificationclick` focuses or opens a same-origin path only.
  - Offline list: navigations to `/` (ignoring the query) are network-first. A 200 response is cached under `/`, and the cached copy is served offline with an "Offline — showing your list from {time}" banner. Redirects, errors and every other route are never cached.
  - `/_next/static/*` assets are cache-first (hashed, immutable), so the cached list can hydrate.
  - `/api/*` and server actions are never touched.
  - Old caches are removed on activate.
- **Registration:** a small client component in the root layout registers the worker (`updateViaCache: "none"`).
- **Headers:** `next.config.ts` serves `/sw.js` with `no-cache` and the CSP from Next's guide. The proxy matcher skips `sw.js`, `manifest.webmanifest` and the icon routes.
- **Privacy on shared devices:** the cached list is personal. Sign-out unsubscribes the device's push subscription and deletes it on the server, and the sign-in page clears the Wayfind caches on load.

### Env keys

| Key | Rule |
| --- | --- |
| `PUSH_SENDER` | `fake` (default) or `webpush` |
| `VAPID_PUBLIC_KEY`, `VAPID_PRIVATE_KEY`, `VAPID_SUBJECT` (`mailto:`) | required when `PUSH_SENDER=webpush`; keys from `npx web-push generate-vapid-keys` |
| `EMAIL_SENDER` | `fake` (default) or `resend` |
| `RESEND_API_KEY`, `EMAIL_FROM` | required when `EMAIL_SENDER=resend` |

Like Phase 5, the build hands you the `.env.example` lines.

### System-scope module

`src/lib/db/notify-sync.ts` holds:

- loading a notification by id;
- the pending sweep;
- the overdue scan (inserts only).

ESLint lets only `src/lib/notifications/**` and `src/jobs/**` import it, with a guard test, and it returns ids and the owning `user_id`, never shipment data. The rule-driven insert lives in `tracker-sync.ts` next to the update it belongs to.

## Steps (one commit each)

1. **Schema** (own commit; load `supabase-postgres-best-practices` first):
   - the three tables, two enums, the indexes and RLS;
   - `npm run db:generate`, then read the SQL;
   - `schema.test.ts` covers: duplicate `(shipment, kind, key)` rejected, unique endpoint, cascade on shipment and user delete, RLS on.

   Commit: `feat(db): notifications, settings and push subscriptions`.
2. **Env** (+ tests for each rule) and `.env.example` lines handed over.

   Commit: `feat(env): push and email sender settings`.
3. **Rules and quiet hours** (`rules.ts`, `quiet-hours.ts`, `settings.ts` with defaults and the zod schema), with table-driven tests.

   Commit: `feat(notifications): alert rules and quiet hours`.
4. **Creating alerts:** wire the rules into `applyTrackerUpdate`; the overdue scan; `notify-sync.ts` with its lint guard. Tests on PGlite cover:
   - each kind fires once per event;
   - a redelivered webhook, a re-fetch after a webhook and concurrent updates fire nothing extra;
   - a late older event fires nothing;
   - a shared tracker gives each user their own single alert;
   - archived shipments are silent.

   Commit: `feat(notifications): create alerts from tracking updates`.
5. **Senders:**
   - `fake`, `webpush` (MSW-mocked push endpoint; 201 sent, 404/410 removes the subscription, 429/5xx retryable) and `resend` (MSW: request shape, idempotency header, 4xx vs 5xx);
   - message builder with escaping tests.

   Install `web-push` and `@types/web-push`. Commit: `feat(notifications): push and email senders`.
6. **Sending jobs:** `send.ts` (claim, skip rules, channels, mark) plus `src/jobs/notifications.ts` (`send-notification`, `notifications-sweep`, `notifications-cleanup`) and events from the webhook route and the re-fetch job. Tests (`@inngest/test` + PGlite) cover:
   - settings respected per channel and kind;
   - quiet hours sleep until their end, including the overnight wrap;
   - superseded and stale alerts skipped;
   - email failure doesn't re-send push;
   - retries exhausted → `failed`;
   - user A's alert never reads B's settings or subscriptions;
   - logs hold no content.

   Commit: `feat(notifications): send alerts from background jobs`.
7. **Settings UI and actions:** the Notifications section, push manager, install card and the four actions. Tests cover:
   - the user comes only from the session, never form data;
   - upsert moves an endpoint between users;
   - unsupported, denied and iOS states;
   - the grid saves and reloads;
   - invalid time zone rejected.

   Commit: `feat(ui): notification settings and push on this device`.
8. **PWA:** manifest, icons, `public/sw.js`, registration, headers, proxy matcher, sign-out and sign-in cache clearing, offline banner. The service worker is tested by loading `public/sw.js` in a Node `vm` with fake `self`, `caches`, `fetch` and `clients`. Tests cover:
   - **caches the list route** and serves it offline;
   - never caches redirects, non-200, `/api`, other routes;
   - static assets are cache-first;
   - push shows a notification;
   - click opens same-origin paths only;
   - activate removes old caches.

   The manifest and icon routes return the right types and sizes.

   Commit: `feat(pwa): manifest, icons, service worker and offline list`.
9. **Docs:**
   - `docs/notifications-setup.md`: VAPID keys, Resend and the domain, local HTTPS push testing, iOS install.
   - CLAUDE.md: Stack, layout, env keys, the new import restriction, notification rules.
   - `docs/unresolved-issues.md`.

   Commit: `docs: Phase 6 notifications and PWA`.

## Explicitly not in Phase 6

- Payments, native apps, AfterShip (out of scope for the MVP).
- An in-app notification inbox or history view.
- One-click email unsubscribe headers (the email links to Settings). Logged for Phase 7 with the privacy policy.
- Offline map, offline adds or background sync.
- Sending email to real users (needs a verified domain). The Resend adapter is built and tested with MSW; the live check is deferred and logged.
- Rate limiting beyond the test-push limit, and Sentry alerts on failed sends (Phase 7).

## Test gate (coverage target 80%)

- **Each rule fires exactly once per event:** redelivery, re-fetch, concurrency and late older events add nothing; a shared tracker gives each user one alert.
- **Settings and quiet hours respected:** channel and kind toggles; held alerts send at the end of quiet hours (overnight wrap, time zones); superseded alerts are dropped.
- **Service worker caches the list route**, serves it offline, and caches nothing it shouldn't.
- **Isolation:** actions take the user from the session only; one user's alert never touches another's settings, subscriptions or shipments; email values are escaped.
- **Checks:** `npm run lint`, `typecheck`, `test:coverage` (≥ 80% on files touched; report the numbers) and `build` pass locally and in CI.
- **Finish:** push (ask first), confirm CI through the GitHub API, tag `phase-6-done`, set CLAUDE.md to Phase 7. List deferred items in the summary.

## Verification (build session)

1. `npm test` is green.
2. **Manual, no domain needed** (`PUSH_SENDER=webpush` with local VAPID keys, `EMAIL_SENDER=fake`, `TRACKING_PROVIDER=fake`):
   1. Run `npm run dev -- --experimental-https` and `npm run jobs:dev`.
   2. In Settings, enable push and click "Send a test": a notification appears.
   3. Add `FAKE-TRANSIT-1` and `curl` `tests/fixtures/fake/webhook-ofd.json`: one push arrives, and the fake email sender logs one email. Send it again: nothing new.
   4. Turn on quiet hours covering now and send another status change: nothing arrives. The Inngest UI shows the run sleeping until the end time.
   5. In Chrome, open the list, go offline in DevTools and reload: the cached list shows with the offline banner. Sign out: the cache is gone.
   6. Chrome's install button appears and installs; the app opens standalone.
3. **Deferred:**
   - Real email delivery (needs a domain verified on Resend).
   - iPhone push (needs the deployed HTTPS app installed to the Home Screen).

   Both get logged in `docs/unresolved-issues.md`.
