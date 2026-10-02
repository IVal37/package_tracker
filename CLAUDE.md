# Wayfind

Package-tracking web app (installable PWA). Users add tracking numbers by hand or by forwarding order emails, then see every package in a list view and on a map with truck / plane / ship / van icons showing where it is and how it's moving.

Full spec, phase details and test-gate criteria: `docs/plan.md`. Read the section for the current phase before starting any work.

## Current phase

**Phase 2 — Accounts, manual add, list view.** (Update this line each time a phase is tagged done.)

## Stack

- Next.js (App Router) + TypeScript (strict)
- Postgres (Supabase, decided in Phase 0) + Drizzle ORM via the `postgres` driver (transaction pooler, `prepare: false`)
- Auth: Supabase Auth or Auth.js (decided in Phase 2)
- Tracking: Ship24 behind the `TrackingProvider` adapter (AfterShip is a later upgrade)
- Background jobs: Inngest or Upstash QStash
- Map: MapLibre GL; geocoding results cached in the `places` table
- Inbound email: Postmark Inbound or Cloudflare Email Routing; field extraction with Claude Haiku 4.5
- Alerts: Web Push (VAPID) + Resend email
- Tests: Vitest, Testing Library, MSW; Playwright only at launch
- Hosting: Vercel

## Commands

Keep these current.

- `npm run dev` — local dev server
- `npm test` — unit tests
- `npm run test:watch` — unit tests in watch mode
- `npm run test:coverage` — unit tests with coverage report
- `npm run lint` — ESLint + Prettier check
- `npm run format` — apply Prettier
- `npm run typecheck` — `tsc --noEmit`
- `npm run db:generate` — generate a migration from the schema
- `npm run db:migrate` — apply migrations (uses `DATABASE_URL_DIRECT` if set)

## Folder layout

Phase 0 may refine this; if it does, update this section.

```
src/
  app/                 pages and layouts
  app/api/             route handlers and webhooks (keep thin)
  components/          UI components
  lib/tracking/        import only from here: index.ts exposes TrackingProvider, getTrackingProvider(), Status, errors
  lib/tracking/ship24/ Ship24Provider (fetch + zod), client, status-map; never imported from outside lib/tracking
  lib/tracking/fake/   FakeProvider (canned scenarios by tracking-number prefix, e.g. FAKE-OFD-1)
  lib/env.ts           typed, server-only env loader (zod); add new env keys here
  lib/db/              Drizzle client, schema and queries
  lib/geo/             geocoder (cache-first) and inferMode()
  lib/email/           inbound email parsing and extraction
  jobs/                background jobs (re-poll, archive, notify, cleanup)
tests/
  db/                  PGlite helper (createTestDb): real Postgres in memory with the real migrations
  setup.ts             Vitest setup (jest-dom, MSW server lifecycle)
  msw/                 shared MSW server; register handlers per test with server.use()
  fixtures/            saved JSON / email fixtures (fixtures/ship24/ built from Ship24's OpenAPI examples)
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

## Code conventions

- TypeScript strict mode; no `any`.
- Validate all external input with zod: request bodies, webhook payloads, provider responses, LLM output.
- Put business logic in pure functions under `src/lib/` so it can be unit tested; route handlers only parse input, call lib code and return a response.
- Nothing outside `src/lib/tracking/` may import a specific provider (ESLint enforces this). Everything goes through `TrackingProvider`.
- `parseWebhook` authenticates first (throws `WebhookAuthError`), then returns `NormalizedShipment[]`: one per tracking, with only the new events, de-duplicated. `deleteTracking` is an unsubscribe on Ship24 (it has no delete endpoint).
- Provider env keys: `TRACKING_PROVIDER` (`fake` default | `ship24`), `SHIP24_API_KEY` and `SHIP24_WEBHOOK_SECRET` (required for ship24), `FAKE_WEBHOOK_SECRET` (required in production). See `.env.example`.
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
- Webhook handlers: authenticate exactly as the provider documents, read the raw body, make processing idempotent, return 2xx quickly and hand heavy work to a background job.
- Forwarded email content is untrusted. The extraction model gets no tools and sees only that one email; its output must pass schema validation before anything is created.
- Raw inbound emails are deleted after 30 days.

## Out of scope for the MVP

- Payments and Stripe. The header "Upgrade" button only opens a "Coming soon" dialog.
- AfterShip integration.
- Native iOS / Android apps.
- Gmail or Outlook OAuth inbox sync.
