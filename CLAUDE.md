# Wayfind

Package-tracking web app (installable PWA). Users add tracking numbers by hand or by forwarding order emails, then see every package in a list view and on a map with truck / plane / ship / van icons showing where it is and how it's moving.

Full spec, phase details and test-gate criteria: `docs/plan.md`. Read the section for the current phase before starting any work.

## Current phase

**Phase 7 — MVP hardening and launch.** (Update this line each time a phase is tagged done.)

## Stack

- Next.js (App Router) + TypeScript (strict)
- Postgres (Supabase, decided in Phase 0) + Drizzle ORM via the `postgres` driver (transaction pooler, `prepare: false`)
- Auth: Supabase Auth (decided in Phase 2): email magic link + Google, cookie sessions via `@supabase/ssr`, all calls server-side
- UI: Tailwind CSS
- Tracking: Ship24 behind the `TrackingProvider` adapter (AfterShip is a later upgrade)
- Background jobs: Inngest (decided in Phase 3): cron functions in `src/jobs/`, served at `/api/inngest`
- Map: MapLibre GL with OpenFreeMap tiles (no key). Geocoding: Nominatim (decided in Phase 4) behind the `Geocoder` interface, results cached in the `places` table
- Inbound email (decided in Phase 5): Cloudflare Email Routing + a small Email Worker (`workers/inbound-email/`, its own `package.json`) posting to our webhook; field extraction with Claude Haiku 4.5 (`claude-haiku-4-5`, `@anthropic-ai/sdk`) behind the `Extractor` interface
- Alerts (decided in Phase 6): Web Push (VAPID, the `web-push` package) behind the `PushSender` interface and Resend email (plain `fetch`) behind `EmailSender`; both sent from Inngest jobs only. Installable PWA: `app/manifest.ts`, generated icons, a hand-written service worker in `public/sw.js`
- Tests: Vitest, Testing Library, MSW; Playwright only at launch
- Hosting: Vercel

## Commands

Keep these current.

- `npm run dev` — local dev server
- `npm run build` — production build (CI runs it)
- `npm test` — unit tests
- `npm run test:watch` — unit tests in watch mode
- `npm run test:coverage` — unit tests with coverage report
- `npm run lint` — ESLint + Prettier check
- `npm run format` — apply Prettier
- `npm run typecheck` — `tsc --noEmit`
- `npm run db:generate` — generate a migration from the schema
- `npm run db:migrate` — apply migrations (uses `DATABASE_URL_DIRECT` if set)
- `npm run jobs:dev` — Inngest dev server (UI at http://localhost:8288); run it next to `npm run dev`
- `npm run eval:email` — runs example emails through the REAL Claude model and prints how many it read correctly. Costs a few cents; needs `ANTHROPIC_API_KEY`; never part of `npm test`. Reads `tests/fixtures/email/retailers.json` plus your own examples in `tests/fixtures/email/real/` (gitignored)
- `predev` / `prebuild` run `scripts/copy-maplibre-worker.mjs`, which copies MapLibre's Web Worker into `public/` (gitignored). MapLibre can't find its own worker under Next's bundler, so the map component points it at `/maplibre-gl-worker.mjs` (`setWorkerUrl`). If the map is blank, check the browser console for "Worker failed to load" and that the file is served as JavaScript; the proxy matcher must skip `.mjs`.

## Folder layout

Phase 0 may refine this; if it does, update this section.

```
src/
  proxy.ts             refreshes the Supabase session; redirects signed-out users to /sign-in
  app/                 pages and layouts; app/actions.ts holds thin Server Actions (add / delete package, dismiss order)
  app/manifest.ts, app/icons/[file]/  web app manifest and the PNG icons drawn in code (lib/pwa/icons.tsx)
  public/sw.js         the service worker: push, the saved package list, hashed static files. Plain JS, tested in a Node sandbox by tests/service-worker.test.ts
  app/sign-in/         sign-in page and actions;  app/auth/callback/ completes magic-link and Google sign-in
  app/api/             route handlers and webhooks (keep thin)
  components/          UI components (Tailwind)
  lib/auth/            Supabase server client, getCurrentUser()/requireUser(), sign-in and callback logic
  lib/shipments/       add / delete logic, validation, grouping, formatting (pure, unit tested)
  lib/tracking/        import only from here: index.ts exposes TrackingProvider, getTrackingProvider(), Status, errors
  lib/tracking/ship24/ Ship24Provider (fetch + zod), client, status-map; never imported from outside lib/tracking
  lib/tracking/fake/   FakeProvider (canned scenarios by tracking-number prefix, e.g. FAKE-OFD-1)
  lib/env.ts           typed, server-only env loader (zod); add new env keys here
  lib/db/              Drizzle client, schema and queries
  lib/db/tracker-sync.ts  system-scope queries for webhooks and jobs (no userId); import-restricted by ESLint
  lib/shipments/sync/  webhook handling, update rule (decideShipmentUpdate), re-fetch and archive logic
  app/api/webhooks/tracking/  provider webhook route (authenticates with the provider's secret)
  app/api/inngest/     serves the Inngest functions
  lib/geo/             infer-mode (inferMode/shipmentMode), map-data (buildMapData), geocode-place (cache-first), place-events, map-style
  lib/geo/geocoder/    import only from index.ts: Geocoder, getGeocoder(); nominatim.ts and fake.ts are never imported from outside lib/geo
  lib/db/geo-sync.ts   system-scope place queries for the geocoding jobs (import-restricted by ESLint)
  lib/email/           alias (forwarding addresses), receive (webhook logic), process (email -> orders and shipments), html-to-text, tracking-patterns, gmail-confirmation, retailer-key, cleanup, eval-score
  lib/email/extract/   import only from index.ts: Extractor, getExtractor(); claude.ts and fake.ts are never imported from outside lib/email. validate.ts grounds and cleans model output
  lib/db/inbound-sync.ts  system-scope alias -> user lookup and email loading for the webhook and jobs (import-restricted by ESLint)
  lib/db/orders.ts, forwarding.ts, inbound-emails.ts  user-scoped queries for orders, the forwarding alias and stored emails
  app/settings/        Settings page: notifications (push on this device, which alerts, quiet hours, install), private forwarding address, Gmail confirmation code, filter instructions
  lib/notifications/   rules (alertsForUpdate, isOverdue), prefs and form parsing, quiet-hours, message (push and email text), send (prepare / deliver / finish one alert), maintenance (sweep, cleanup), subscription (endpoint allow-list), test-push, rate-limit, events
  lib/notifications/senders/  import only from index.ts: PushSender, EmailSender, getPushSender(), getEmailSender(); webpush.ts, resend.ts and fake.ts are never imported from outside lib/notifications
  lib/db/notify-sync.ts  system-scope alert queries: the overdue scan, loading and finishing an alert, the sweep (import-restricted by ESLint)
  lib/db/notification-settings.ts, push-subscriptions.ts  user-scoped queries for a user's alert settings and devices
  lib/pwa/             browser-side helpers (register the service worker, push support detection, device clean-up) and the icon drawing
  app/api/webhooks/inbound-email/  inbound email webhook (authenticates with INBOUND_WEBHOOK_SECRET)
  jobs/                Inngest functions (re-fetch stale, archive delivered, geocode, process inbound email and its sweep and cleanup, send notification and its sweep and cleanup), thin wrappers over lib code
tests/
  db/                  PGlite helper (createTestDb): real Postgres in memory with the real migrations
  setup.ts             Vitest setup (jest-dom, MSW server lifecycle)
  msw/                 shared MSW server; register handlers per test with server.use()
  fixtures/            saved JSON / email fixtures (fixtures/ship24/ built from Ship24's OpenAPI examples)
workers/
  inbound-email/       Cloudflare Email Worker (own package.json and lockfile; handler.ts is pure and tested by the root Vitest run, index.ts is not part of the root typecheck or lint)
scripts/               copy-maplibre-worker.mjs; eval-email.eval.ts (run by `npm run eval:email`)
drizzle/               migrations
docs/
  plan.md              full build plan
  phase-N-plan.md      plan written at the start of each phase
```

## Workflow rules

- Work only on the current phase. Do not build features from later phases or the backlog.
- Plan sessions write `docs/phase-N-plan.md` only. No code in a plan session.
- Build sessions implement the matching `docs/phase-N-plan.md`. If the plan turns out to be wrong or incomplete, stop and say so instead of improvising a different design.
- Make small commits with clear messages. Schema and migration changes go in their own commit, before feature code.
- A phase is done only when its Test gate passes in CI and the commit is tagged `phase-N-done`.
- Ask before adding any dependency that is not listed under Stack.
- Issues, bugs or unknowns that should be tested before shipping but are not pressing and do not block development: do not fix them mid-phase. Either put them in the later phase in `docs/plan.md` where they fit, or log them in `docs/unresolved-issues.md` for the final sweep (a full review with Fable before launch). Mention them in the end-of-phase summary.

## Code conventions

- TypeScript strict mode; no `any`.
- Validate all external input with zod: request bodies, webhook payloads, provider responses, LLM output.
- Put business logic in pure functions under `src/lib/` so it can be unit tested; route handlers only parse input, call lib code and return a response.
- Nothing outside `src/lib/tracking/` may import a specific provider (ESLint enforces this). Everything goes through `TrackingProvider`.
- `parseWebhook` authenticates first (throws `WebhookAuthError`), then returns `NormalizedShipment[]`: one per tracking, with only the new events, de-duplicated. `deleteTracking` is an unsubscribe on Ship24 (it has no delete endpoint).
- Auth env keys: `SUPABASE_URL`, `SUPABASE_PUBLISHABLE_KEY` (server-only, never `NEXT_PUBLIC_*`) and `APP_URL` (public origin for auth redirects). Setup steps are in `docs/supabase-setup.md`.
- Provider env keys: `TRACKING_PROVIDER` (`fake` default | `ship24`), `SHIP24_API_KEY` and `SHIP24_WEBHOOK_SECRET` (required for ship24), `FAKE_WEBHOOK_SECRET` (required in production). See `.env.example`.
- Job env keys: `INNGEST_SIGNING_KEY` (required in production; the SDK reads it itself), `INNGEST_EVENT_KEY` (required in production; needed to send events) and `INNGEST_DEV=1` for local development. Setup steps are in `docs/webhooks-and-jobs-setup.md`.
- Geocoder env key: `GEOCODER` (`fake` default | `nominatim`). The fake never touches the network; use it for local development and tests.
- Inbound email env keys: `INBOUND_EMAIL_DOMAIN` (forwarding addresses are `<alias>@<domain>`; default `in.localhost` in development, required in production), `INBOUND_WEBHOOK_SECRET` (shared with the Worker; default `dev-inbound-secret` in development, required in production), `INBOUND_DAILY_LIMIT` (stored emails per user per day, default 50), `EMAIL_EXTRACTOR` (`fake` default | `claude`) and `ANTHROPIC_API_KEY` (required only when `EMAIL_EXTRACTOR=claude`). Setup steps and a no-domain local walkthrough are in `docs/email-forwarding-setup.md`.
- Notification env keys: `PUSH_SENDER` (`fake` default | `webpush`), `VAPID_PUBLIC_KEY`, `VAPID_PRIVATE_KEY` and `VAPID_SUBJECT` (all three required when `PUSH_SENDER=webpush`; generate keys with `npx web-push generate-vapid-keys`; the private key is server-only), `EMAIL_SENDER` (`fake` default | `resend`), `RESEND_API_KEY` and `EMAIL_FROM` (both required when `EMAIL_SENDER=resend`; the from address needs a domain verified in Resend). The fakes never touch the network. Setup steps and a no-keys local walkthrough are in `docs/notifications-setup.md`.
- Internal shipment status is the `Status` enum: `Pending`, `InfoReceived`, `InTransit`, `OutForDelivery`, `AttemptFail`, `Delivered`, `AvailableForPickup`, `Exception`, `Expired`. Provider-specific statuses are mapped to it inside the provider.
- File names in kebab-case; components and types in PascalCase; functions and variables in camelCase.

## Testing rules

- Every new module gets Vitest unit tests in the same phase it is written.
- Mock all external HTTP with MSW and saved fixtures in `tests/fixtures/`. Tests never call real Ship24, Claude, geocoding or email services.
- Local development uses the fake provider (`TRACKING_PROVIDER=fake`) to save the Ship24 free quota (10 shipments/month).
- Each phase has a coverage target in `docs/plan.md`. Run `npm run test:coverage` and report the numbers at the end of a Test gate.
- Never weaken, skip or delete a failing test to make it pass. Fix the code, or explain why the test itself is wrong and ask.

## Security and privacy rules

- Never read, print or commit `.env` files. Secrets come from environment variables, are read server-side only, and are never sent to the browser.
- Every query or mutation on user data checks that the signed-in user owns it (or relies on row-level security).
- Every function in `src/lib/db/shipments.ts` takes `userId` and filters by it; do not add an unscoped shipments query. Another user's shipment must look exactly like a missing one. Take `userId` only from `requireUser()` (the verified session), never from form data, query strings or request bodies.
- Authorize on the server with `getClaims()`, never `getSession()`. The app connects to Postgres as the table owner (RLS does not apply), so the query-layer checks are the real guard; RLS is enabled with no policies on every table to deny Supabase's Data API.
- Any page that reads the session must stay dynamic (`createSupabaseServerClient` reads cookies first), so builds never need env values.
- Webhook handlers: authenticate exactly as the provider documents, read the raw body, make processing idempotent, return 2xx quickly and hand heavy work to a background job. A small, indexed update (the Phase 3 tracking webhook) may apply inline; a database failure returns 500 so the provider retries. Never log the body, headers or secret.
- System-scope exception: webhooks and jobs act for no user, because one provider tracker can be shared by several users' shipments. Those queries live only in `src/lib/db/tracker-sync.ts`, which ESLint lets only `src/lib/shipments/sync/**` and `src/jobs/**` import. They apply updates and return counts; never return shipment data from them to anything that renders it, and never add a user-facing query there. The same holds for `src/lib/db/geo-sync.ts` (geocoding), which ESLint lets only `src/lib/geo/**` and `src/jobs/**` import and which returns place text only.
- Nothing outside `src/lib/geo/` may import a specific geocoder (ESLint enforces this); go through `@/lib/geo/geocoder`. Client components must not import `@/lib/tracking` for values (it pulls provider code and `node:crypto` into the browser bundle); import `@/lib/tracking/status` instead.
- Nothing outside `src/lib/email/` may import a specific extractor (ESLint enforces this); go through `@/lib/email/extract`. `src/lib/db/inbound-sync.ts` (looks a user up by forwarding alias, loads stored emails for the job) is system-scope: ESLint lets only `src/lib/email/**` and `src/jobs/**` import it, and it returns a user id or the stored email, never anything rendered to a user. Everything the signed-in user touches (alias, orders, dismissing an order) is a normal `userId`-scoped query.
- Nothing outside `src/lib/notifications/` may import a specific sender (ESLint enforces this); go through `@/lib/notifications/senders`. `src/lib/db/notify-sync.ts` is system-scope (it scans every user's shipments and loads an alert by id): ESLint lets only `src/lib/notifications/**` and `src/jobs/**` import it, and it returns ids, counts and the alert row, never shipment contents. Everything the signed-in user touches (settings, devices) is a normal `userId`-scoped query.
- Map and place data: coordinates live only in `places` (a global cache, not user data) and are joined on read through the Postgres-generated `location_key` / `destination_key`. Never copy coordinates onto checkpoints. Location text is the only shipment data sent to the geocoder: never names, street addresses or tracking numbers.
- Shipment status is decided by event time, never by ranking statuses: a late older event is stored but must not change status or ETA (`decideShipmentUpdate`).
- Forwarded email content is untrusted. The extraction model gets no tools and sees only that one email; its output must pass schema validation before anything is created.
  - The user is fixed by the envelope recipient's alias when the webhook stores the email. Nothing in the email or in the model's output can select, change or name a user; the model has no field for one.
  - A tracking number from the model is accepted only if it passes the Add form's format rule and literally appears in the email (`groundTrackingNumbers`). Shipments are created only through `addShipment` and `TrackingProvider`.
  - Strings that came from an email (retailer, item, order number) are rendered as React text only: never as HTML, a URL or a link target.
  - An unknown alias, a repeated Message-ID and a user over the daily cap all answer 200 and store nothing, so a prober learns nothing. Logs hold outcomes and counts only, never the body, subject, addresses or secret.
  - Orders match on `(user, retailer key, order number)`; an order number alone is never enough (Shopify stores all start at `#1001`).
- Raw inbound emails are deleted after 30 days; "Ordered" placeholders that never shipped are deleted after 90 days (daily cleanup job).
- Alerts (Phase 6):
  - An alert is recorded only by `applyTrackerUpdate`, in the same transaction as the status change, and by the hourly overdue scan. The unique key `(shipment, kind, dedupe_key)` is what makes "once per event" true: a redelivered webhook, a re-fetch and a late older event record nothing. Archived shipments never alert, and a shipment added by hand or from an email never alerts at creation.
  - Alerts are sent from jobs only. The one exception is Settings' "Send a test", limited to 3 a minute per user and sent only to that user's own devices.
  - The alert row fixes who it is for. Delivery then reads that user's settings, devices, email and shipment afresh, each scoped by that user id; nothing personal is carried between job steps. An alert held by quiet hours is decided again when it wakes, and one overtaken by a newer alert for the same shipment, or more than a day old, is dropped.
  - The server POSTs to every stored push endpoint, so a subscription is accepted only for an HTTPS endpoint on the known push services (`isAllowedPushEndpoint`): an arbitrary URL would let a user make the server call internal hosts.
  - Words in an alert may come from a forwarded email (untrusted): the email's HTML escapes every value, links are built only from `APP_URL` and a UUID, and the tracking number never appears in a push title or body.
  - `public/sw.js` caches only the list at exactly `/` (no query, a plain 200, never a redirect) and hashed `/_next/static` files; it never touches `/api`, a non-GET request, another page or an error. The manifest, icons and `sw.js` are public (browsers fetch them without cookies): `isPublicPath` and the proxy matcher both say so. Signing out removes the device's push subscription and the saved list; the sign-in page clears the saved list too.

## Out of scope for the MVP

- Payments and Stripe. The header "Upgrade" button only opens a "Coming soon" dialog.
- AfterShip integration.
- Native iOS / Android apps.
- Gmail or Outlook OAuth inbox sync.
