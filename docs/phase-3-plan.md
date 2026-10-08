# Phase 3 — Live updates: plan

Decisions: Inngest for background jobs (2026-10-07); the webhook applies updates inline and relies on Ship24's retries instead of a queue; dependencies `inngest` and `@inngest/test` approved (2026-10-07).


## Goal

Shipments update without the user doing anything. Ship24 webhooks add new checkpoints and move the status forward. An hourly job re-fetches shipments that have had no update for 24 hours. A daily job archives shipments that were delivered 14 or more days ago. A late or repeated webhook can never duplicate a checkpoint or move a status backwards.

## Facts that shape this design

These come from Ship24's and Inngest's docs and Vercel's limits, read 2026-10-07.

- **Ship24 webhook auth:** each request carries `Authorization: Bearer <webhook secret>`. There is no HMAC signature and no IP allowlist. `verifyBearerSecret` and both providers' `parseWebhook` already implement this (Phase 1).
- **Ship24 retries:** any non-2xx response is retried up to 20 times, with exponential backoff from a few seconds to a few hours.
- **Ship24 ordering:** webhooks are *not* guaranteed to arrive in order, and Ship24 tells receivers to compare event timestamps. Each webhook carries one tracking, and its `events` array always holds exactly one event. Ship24 can batch updates (about a 15-minute delay) if asked, but we keep the default.
- **Ship24 has no "expired" milestone.** `Expired` is Wayfind's own status, and no phase assigns it yet (see "Explicitly not in Phase 3").
- **One Ship24 tracker can belong to several users.** `createTracking` is idempotent, so two users adding the same number share one `provider_tracker_id`. An update for a tracker applies to every shipment row with that tracker.
- **Vercel Hobby cron runs at most once a day**, which is too slow for the 24-hour re-fetch. That is why the jobs run on Inngest.
- **Inngest v4:** `new Inngest({ id })`, `serve` from `inngest/next` at `src/app/api/inngest/route.ts` (GET, POST, PUT), and cron triggers that accept `TZ=...` prefixes. Production needs `INNGEST_SIGNING_KEY`. Local development runs `npx inngest-cli@latest dev`, with its UI at `http://localhost:8288`. `@inngest/test` (`InngestTestEngine`) runs functions under Vitest.
- **Free tiers:** Inngest allows 50,000 step runs a month. The jobs below use one step per run: an hourly job plus a daily job is about 750 a month.

## Dependencies (approved 2026-10-07)

| Package | Why |
| --- | --- |
| `inngest` (v4) | Background jobs (Stack: "Inngest or Upstash QStash"; Inngest chosen) |
| `@inngest/test` (dev) | Runs Inngest functions in Vitest with mocked steps |

These two packages are approved and nothing else. `inngest-cli` runs through `npx` and is not added to `package.json`.

## Design decisions

- **The webhook applies updates inline; no queue in Phase 3.** One webhook means one event and a few indexed queries, well under 100 ms. On a database error the route returns 500 and Ship24 retries (up to 20 times), which gives us a durable retry without running our own queue. The "heavy work" the spec wants queued (geocoding in Phase 4, notifications in Phase 6) doesn't exist yet. Those phases will have the webhook send an Inngest event.
- **One provider-agnostic route:** `POST /api/webhooks/tracking` calls `getTrackingProvider().parseWebhook(...)`. The Ship24 dashboard points at it, and in development the fake provider accepts its own payloads at the same URL. Nothing provider-specific leaks out of `lib/tracking`.
- **Webhook responses:**

  | Case | Response | Why |
  | --- | --- | --- |
  | Missing or wrong secret (`WebhookAuthError`) | 401 | Unauthenticated |
  | Authenticated, but body isn't JSON or fails the schema (`ProviderResponseError`) | 422 | Ship24 retries it, so a payload our schema wrongly rejects is recovered after a fix ships |
  | Authenticated and valid, but the tracker matches no shipment (e.g. the dashboard test message) | 200 | Nothing to do; never make Ship24 retry it |
  | Applied, including duplicates that change nothing | 200 | Idempotent |
  | Database error | 500 | Ship24 retries |

  Logs record the outcome and counts only, never the body, headers or secret.
- **Status never moves backwards.** This is decided in time order, not by ranking statuses. A ranking would be wrong: `AttemptFail → OutForDelivery` (a re-attempt) and `Exception → InTransit` both happen in real life. The rule, as a pure function `decideShipmentUpdate(current, incoming)`:
  - Checkpoints are always inserted (de-duplicated by `(shipment_id, provider_event_id)`), so the timeline is complete whatever the arrival order.
  - The incoming `status` and `eta` are applied only if the incoming newest event time is **≥** the stored `last_event_at`, or the stored value is null. `≥` makes a repeated delivery a harmless no-op, and lets a same-timestamp update win.
  - An incoming payload with no events changes `status` and `eta` only when the shipment has no events yet (`last_event_at` is null).
  - `last_event_at` becomes the later of the stored and incoming values, so it never moves backwards either.
  - `last_synced_at` is set to now on every applied webhook or re-fetch, even one that changes nothing.
- **Per-tracker updates run in one transaction:** `SELECT ... FOR UPDATE` on that tracker's shipment rows, insert the checkpoints, decide in TypeScript, then `UPDATE`. The row lock makes two concurrent webhooks for the same tracker apply one after the other, so the rule lives in one tested function instead of being duplicated in SQL.
- **System-scope queries live in their own module, `src/lib/db/tracker-sync.ts`.** Webhooks and jobs act for no user and look shipments up by `(provider, provider_tracker_id)` across users. That breaks the `shipments.ts` rule "every function takes userId", so these queries are kept out of that file:
  - The module's header says it is system-only.
  - An ESLint `no-restricted-imports` rule allows importing it only from `src/lib/shipments/sync/**`, `src/jobs/**` and its own tests. Pages, actions and route handlers can't reach it.
  - Nothing in it returns shipment data to a caller that renders it; it only applies updates and returns counts.
  - CLAUDE.md gets a matching rule.
- **New column `shipments.last_synced_at`** (`timestamptz not null default now()`). The re-fetch job needs "when did we last check", not "when did the courier last scan". Without it, a quiet shipment would be fetched every hour forever. With `NOT NULL DEFAULT now()`, new rows get it for free and the stale query stays index-friendly (no `coalesce`).
- **Indexes (partial, small):**
  - `shipments_sync_due_idx` on `(provider, last_synced_at)` where `archived_at is null and status not in ('Delivered','Expired')`.
  - `shipments_archive_due_idx` on `(last_event_at)` where `status = 'Delivered' and archived_at is null`.

  The existing `shipments_provider_tracker_idx` serves the webhook lookup. The build session loads the `supabase-postgres-best-practices` skill before writing the schema change.
- **Re-fetch job** (`refetch-stale`, hourly cron `0 * * * *`, concurrency 1):
  1. Select distinct `provider_tracker_id`s whose shipments match all of these:
     - `provider = current provider name`, so rows the fake provider made are skipped under ship24 and vice versa
     - not archived
     - status not `Delivered` or `Expired`
     - `last_synced_at < now - 24h`
     - `provider_tracker_id` is not null

     Oldest sync first, limit 100 a run.
  2. For each tracker, call `provider.getTracking` and apply the result with the same function the webhook uses.
  3. `TrackerNotFoundError`, or any other non-retryable error: log it, set `last_synced_at = now` for that tracker's rows (so a broken tracker can't block the front of the queue every hour), and continue.
  4. A retryable error (`RateLimitedError`, `ProviderUnavailableError`): stop the run. What's left is picked up next hour.
  5. Return `{ checked, updated, failed, stoppedEarly }`.

  Fetching an existing Ship24 tracker's results doesn't use up the new-shipment quota.
- **Archive job** (`archive-delivered`, daily cron `TZ=UTC 30 3 * * *`, concurrency 1): a single `UPDATE` sets `archived_at = now` where `status = 'Delivered'`, `archived_at is null` and `last_event_at <= now - 14 days`. It returns the count. It doesn't unsubscribe the Ship24 tracker, because the tracker may be shared and Ship24 stops updating delivered trackers anyway.
- **Job logic is plain functions with injected `db`, `provider` and `now`**, tested on PGlite. The Inngest functions in `src/jobs/` are thin wrappers: one `step.run` calling the lib function. Each one is tested once with `InngestTestEngine`.
- **The proxy must let webhook and Inngest traffic through.** `/api/webhooks/*` and `/api/inngest` become public paths. Each authenticates itself: the bearer secret for webhooks, and Inngest's signing key, checked by `serve`.
- **Env:** `INNGEST_SIGNING_KEY` is optional in development and required when `NODE_ENV=production`, the same pattern as `FAKE_WEBHOOK_SECRET`. The route calls `getEnv()` before `serve` handles a request, so a misconfigured deploy fails loudly. `INNGEST_DEV=1` goes in `.env.example` for local development; the SDK reads it directly. `INNGEST_EVENT_KEY` isn't needed until something sends events (Phase 4).
- **No live UI push.** The list page is already dynamic, so updated data shows on the next load or navigation. Realtime refresh is not in this phase.

## Steps (one commit each)

### 1. Schema: `last_synced_at` + partial indexes (own commit, before feature code)
- Load the `supabase-postgres-best-practices` skill.
- `src/lib/db/schema.ts`: add `lastSyncedAt` (`last_synced_at`, `timestamptz not null default now()`) and the two partial indexes. Run `npm run db:generate`, which produces `drizzle/0002_*.sql`. Check the SQL: the column add must not rewrite the table needlessly, and the index predicates must be right.
- Extend `src/lib/db/schema.test.ts`: the column exists, is NOT NULL and has a default; both indexes exist (via `pg_indexes`).

Commit: `feat(db): add shipments.last_synced_at and sync/archive indexes`

### 2. Update rule — `src/lib/shipments/sync/decide-update.ts`
- `decideShipmentUpdate(current: { status, eta, lastEventAt }, incoming: NormalizedShipment, now: Date)` returns the new `{ status, eta, lastEventAt, lastSyncedAt }`.
- Table-driven tests:
  - newer event: status and ETA applied
  - older event (late webhook): status and ETA kept, `lastEventAt` not lowered
  - equal timestamp: applied
  - stored `lastEventAt` null: applied
  - no incoming events with a known history: kept
  - no incoming events and no history: applied
  - `AttemptFail → OutForDelivery` and `Exception → InTransit` both allowed when newer
  - `Delivered` followed by an *older* `InTransit`: stays `Delivered`
  - `lastSyncedAt` is always `now`

Commit: `feat(shipments): time-ordered shipment update rule`

### 3. System-scope sync queries — `src/lib/db/tracker-sync.ts`
- `applyTrackerUpdate(db, provider: string, incoming: NormalizedShipment, now)`. In one transaction:
  1. Lock `shipments` where `provider` and `provider_tracker_id` match.
  2. For each row, `insertCheckpoints` and `decideShipmentUpdate`, then `UPDATE`.
  3. Return `{ shipments: number, newCheckpoints: number }`.

  With no matching rows it returns zeros.
- `findStaleTrackers(db, provider, now, limit)` returns distinct tracker ids, by the re-fetch rules above.
- `markTrackerSynced(db, provider, trackerId, now)`.
- `archiveDeliveredBefore(db, cutoff, now)` returns the count.
- ESLint: add the `no-restricted-imports` override for `@/lib/db/tracker-sync`.
- PGlite tests:
  - A tracker shared by users A and B: both rows get the checkpoint and the status.
  - Applying the same payload twice: no duplicate checkpoints, and the second call reports 0 new checkpoints.
  - A late older event: the checkpoint is stored, the status is unchanged.
  - An unknown tracker: zeros, nothing written.
  - Another provider's row with the same tracker id: untouched.
  - The stale query picks only stale, non-archived, non-terminal rows of this provider. Fresh, archived, `Delivered`, `Expired`, other-provider and null-tracker rows are each excluded.
  - Archive touches only `Delivered` rows at least 14 days old: exactly at the cutoff is included, a day newer is not, other statuses and already-archived rows are untouched.

Commit: `feat(db): system-scope tracker sync and archive queries`

### 4. Webhook handling — `src/lib/shipments/sync/handle-webhook.ts` + route
- `handleTrackingWebhook({ db, provider, rawBody, headers, now })` returns `{ status: 200 | 401 | 422, applied: number, newCheckpoints: number }`. It maps `WebhookAuthError` to 401 and `ProviderResponseError` to 422, and lets database errors throw.
- `src/app/api/webhooks/tracking/route.ts`:
  - `export const dynamic = "force-dynamic"`
  - read `await request.text()`, call the lib function, return `new Response(null, { status })`
  - catch anything thrown, log it without the body, and return 500
- `src/lib/auth/paths.ts`: make `/api/webhooks/*` and `/api/inngest` public. Update the `isPublicPath` table test.
- Tests on PGlite with `FakeProvider` (built through `createTrackingProvider`):
  - correct secret: 200, rows updated
  - missing, wrong or almost-right secret: 401, nothing written
  - tampered body with the right secret: 422
  - duplicate delivery: no duplicate checkpoints
  - late older event: status kept
  - unknown tracker: 200
- One Ship24-specific test through `Ship24Provider`, using `tests/fixtures/ship24/webhook-events.json`, so the real payload shape is covered end to end.
- Route test (lib mocked): status passthrough, a thrown error gives 500, and the body is never logged (spy on `console`).

Commit: `feat(webhooks): authenticated, idempotent tracking webhook`

### 5. Jobs — `src/lib/shipments/sync/refetch-stale.ts`, `archive-delivered.ts`, `src/jobs/`
- `refetchStaleShipments({ db, provider, now, limit })` and `archiveDeliveredShipments({ db, now })`, following the design above.
- `src/jobs/client.ts` holds `new Inngest({ id: "wayfind" })`. `src/jobs/refetch-stale.ts` and `src/jobs/archive-delivered.ts` hold the cron functions (concurrency 1, one `step.run` each). `src/jobs/index.ts` exports the function list.
- `src/app/api/inngest/route.ts`: `getEnv()`, then `serve({ client, functions })`.
- `src/lib/env.ts`: add `INNGEST_SIGNING_KEY` (required in production). Update `.env.example` (adds `INNGEST_SIGNING_KEY=` and `INNGEST_DEV=1`) and the env tests.
- `package.json`: `"jobs:dev": "npx inngest-cli@latest dev -u http://localhost:3000/api/inngest"`.
- Tests:
  - **Re-fetch (PGlite + FakeProvider with a spy):**
    - only stale trackers are fetched
    - a shared tracker is fetched once
    - an update is applied and `last_synced_at` advances
    - `TrackerNotFoundError` marks the tracker synced and the run continues
    - `RateLimitedError` stops the run, and the remaining trackers stay stale
    - the limit is respected
  - **Archive (PGlite):** only rows delivered 14 or more days ago, and a second run archives 0.
  - **Inngest wrappers (`InngestTestEngine`):** each calls its lib function and returns its result, and each has the expected cron trigger.
  - **Env:** a missing `INNGEST_SIGNING_KEY` throws in production and is fine in development.

Commit: `feat(jobs): hourly stale re-fetch and daily archive on Inngest`

### 6. Docs + CLAUDE.md
- CLAUDE.md:
  - **Stack:** "Background jobs: Inngest (decided in Phase 3)".
  - **Commands:** `npm run jobs:dev`.
  - **Folder layout:** `src/lib/shipments/sync/`, `src/lib/db/tracker-sync.ts` (system-scope, lint-restricted), `src/jobs/`, `app/api/webhooks/tracking/`, `app/api/inngest/`.
  - **Security rules:** the system-scope exception, and "webhook and job code never returns shipment data to a user".
  - **Env keys:** `INNGEST_SIGNING_KEY`, `INNGEST_DEV`.
- `docs/webhooks-and-jobs-setup.md`, a checklist for the user:
  1. Ship24 dashboard: set the webhook URL to `<APP_URL>/api/webhooks/tracking`, copy the webhook secret into `SHIP24_WEBHOOK_SECRET`, and send the test message.
  2. Inngest: create an account, install the Vercel integration (it sets `INNGEST_SIGNING_KEY`), or set the key by hand.
  3. Local development: `npm run dev` plus `npm run jobs:dev`, then trigger the jobs from the Inngest UI.
  4. Sending a fake webhook with `curl` (a sample body is in `tests/fixtures/fake/webhook-ofd.json`).

Commit: `docs: Phase 3 webhook and job setup`

## Explicitly not in Phase 3

- Geocoding, `inferMode()` and the map (Phase 4). The webhook doesn't send events yet.
- Notifications (Phase 6)
- Rate limiting public endpoints (Phase 7)
- Live UI refresh (websockets or polling)
- **Setting `Expired`.** Scheduled for Phase 7 in `docs/plan.md`; until then, re-fetch keeps checking quiet shipments while they're unarchived.
- Unsubscribing Ship24 trackers on archive
- Ship24 batched webhooks

## Test gate (coverage target 90%)

- **Authentic webhook accepted:** 200, the checkpoint is stored and the status is updated, through both providers (Ship24 via the fixture).
- **Tampered or unauthenticated webhook rejected:** a missing, wrong or near-miss secret gives 401 with nothing written; a malformed body with a valid secret gives 422.
- **Duplicate delivery:** no duplicate checkpoints, and the second call reports 0 new.
- **Out of order:** a late older event never moves the status back, and is still added to the timeline.
- **Re-fetch job:** picks only stale, non-archived, non-terminal shipments of the current provider; a shared tracker is fetched once; it stops on rate limiting.
- **Archive job:** touches only `Delivered` shipments at least 14 days old; a second run is a no-op.
- **Isolation:** `tracker-sync` can't be imported from `src/app/**` (a lint test or ESLint `--rule` check on a fixture), and webhook and job outputs contain counts only.
- **Checks:** `npm run lint`, `typecheck`, `test:coverage` and `build` pass locally and in CI, with coverage at least 90% on files touched in Phase 3. Report the numbers.
- **Finish:** push (ask first), confirm CI through the GitHub API, tag `phase-3-done`, and set CLAUDE.md "Current phase" to Phase 4.

## Verification (build session)

1. `npm test`: all green.
2. **Manual, with the fake provider:**
   1. Run `npm run dev` and `npm run jobs:dev`.
   2. Add `FAKE-TRANSIT-1`.
   3. `curl` a fake webhook with an `OutForDelivery` event for that tracker; the list shows "Out for delivery" after a reload.
   4. Send the same `curl` again: no duplicate in the timeline.
   5. Send an older `InTransit` event: the status stays.
   6. Send the request without the secret: 401.
   7. In the Inngest UI, run both functions by hand and check their returned counts.
3. **Once the user has done `docs/webhooks-and-jobs-setup.md`:** send the Ship24 dashboard test webhook to a deployed preview, or through a tunnel, and confirm a 200.
