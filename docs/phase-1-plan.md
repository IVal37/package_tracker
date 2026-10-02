# Phase 1 — Data model and tracking-provider adapter: plan

Decisions: PGlite for DB tests (2026-10-02); Ship24 called with plain fetch + zod (no SDK).


## Goal

Build the final Drizzle schema with migrations, plus a `TrackingProvider` layer with two implementations: `Ship24Provider` (real, over `fetch`) and `FakeProvider` (canned data). Both must pass one shared contract test suite. This phase adds no routes, UI, jobs or auth.

## Facts from the Ship24 API spec that shape this design

These come from the OpenAPI spec and docs, read 2026-10-02.

- **Auth:** every request sends `Authorization: Bearer <api key>`.
- **Status data:** each shipment and each event carries a `statusMilestone`, which is always present. There are 8 values: `pending`, `info_received`, `in_transit`, `out_for_delivery`, `failed_attempt`, `available_for_pickup`, `delivered`, `exception`. There is also an optional, finer `statusCode` (for example `delivery_delivered` or `exception_lost`) and a `statusCategory`. Ship24 has **no "expired" milestone**: `Expired` is assigned by Wayfind itself, by a later job.
- **`POST /public/v1/trackers/track`:** creates a tracker *and* returns results. It is **idempotent**: the same tracking number returns the existing tracker instead of an error. A real duplicate shows up as `409` with `tracker_conflict` or `request_conflict`.
- **No delete endpoint.** "Deleting" a tracker means `PATCH /public/v1/trackers/{trackerId}` with `{ "isSubscribed": false }`.
- **Getting results:** `GET /public/v1/trackers/{trackerId}/results` returns `{ data: { trackings: [tracking] } }`.
- **A `tracking`** = `{ tracker, shipment, events[], statistics }`. Events are newest-first, and each has:
  - a unique `eventId`
  - `occurrenceDatetime`, a "logistics datetime": it may have no UTC offset, or be a date only, e.g. `2021-03-04`
  - `order`, which breaks ties when timestamps are equal
  - `status` (raw text), `location` (raw text, nullable), `courierCode` and the status fields
  
  `shipment.delivery.estimatedDeliveryDate` is the ETA.
- **Errors:** the body is `{ errors: [{ code, message }], data: null }`.

  | HTTP | Meaning |
  | --- | --- |
  | 400 | `validation_error` (bad tracking number) |
  | 401 | bad API key |
  | 403 | `quota_limit_reached` or `no_active_subscription` |
  | 404 | `tracker_not_found` |
  | 409 | conflict |
  | 429 | rate limited; Ship24 recommends exponential back-off |
  | 5xx | server error |

  No `Retry-After` header is documented.
- **Webhooks:**
  - The body is `{ trackings: [tracking + metadata{ messageId, generatedAt, topic }] }`.
  - Only the events found since the last push are included.
  - Authentication is `Authorization: Bearer <webhook secret>`, using the secret shown in the dashboard.
  - Delivery is **not in order**, and Ship24 retries up to 20 times on any non-2xx response.

## Dependencies to approve

- `@electric-sql/pglite` (dev): in-process Postgres for schema and migration tests, through `drizzle-orm/pglite`.

That is the only new package. Approving this plan approves it.

## Interface changes from the `docs/plan.md` starting point

- `parseWebhook(rawBody, headers)` returns `Promise<NormalizedShipment[]>` instead of `NormalizedEvent[]`. Each webhook item is a whole tracking (tracker id + shipment status + new events), and Phase 3 needs the tracker id and shipment status to apply it. It **verifies authentication first** and throws `WebhookAuthError`.
- `deleteTracking` is implemented on Ship24 as unsubscribe (`isSubscribed: false`).
- Courier hints: `createTracking({ trackingNumber, courierHint?, destinationPostCode?, destinationCountryCode? })`, because Ship24 says some couriers need these.

## Steps (one commit each, in this order)

### 1. Status and normalized types — `src/lib/tracking/types.ts`, `src/lib/tracking/status.ts`
- `STATUSES` is a `const` array of the 9 CLAUDE.md values, with `type Status = (typeof STATUSES)[number]`. `MODES = ["truck","plane","ship","van","pin"]`. Both live in `status.ts` so the DB schema can import them without importing a provider.
- `NormalizedEvent = { providerEventId, occurredAt: Date, status: Status, message: string | null, locationText: string | null, courierCode: string | null, order: number | null }`.
- `NormalizedShipment = { providerTrackerId, trackingNumber, courier: string | null, status: Status, eta: Date | null, lastEventAt: Date | null, events: NormalizedEvent[] }`. Events are sorted newest-first and de-duplicated.
- The `TrackingProvider` interface uses the signatures above.
- Typed errors in `src/lib/tracking/errors.ts`. All extend `TrackingProviderError`, which has a `retryable` flag:
  - `ProviderAuthError` (401)
  - `InvalidTrackingNumberError` (400 `validation_error`)
  - `QuotaExceededError` (403)
  - `TrackerNotFoundError` (404)
  - `RateLimitedError` (429, after retries)
  - `ProviderUnavailableError` (5xx or network, after retries)
  - `ProviderResponseError` (the response failed zod validation)
  - `WebhookAuthError`

  Error messages never include the API key or webhook secret.

Commit: `feat(tracking): add Status enum, normalized types and provider interface`

### 2. Drizzle schema + migration (own commit, before feature code) — `src/lib/db/schema.ts`, `drizzle/0000_*.sql`
- `pgEnum`s:
  - `shipment_status` from `STATUSES`
  - `transport_mode` from `MODES`
  - `parse_status` (`pending`, `parsed`, `failed`, `ignored`)
- Tables (uuid PKs `defaultRandom()`, every timestamp `timestamptz`):
  - **users**: `id`, `email` (unique, not null), `forwarding_alias` (unique, nullable), `created_at`. Phase 2 links this to whichever auth it picks, through a later migration.
  - **shipments**:
    - Columns: `id`, `user_id` (FK users, on delete cascade), `tracking_number`, `courier`, `nickname`, `provider` (text, e.g. `ship24` or `fake`), `provider_tracker_id`, `status` (default `Pending`), `eta`, `last_event_at`, `archived_at`, `created_at`, `updated_at`.
    - Constraints and indexes: **unique (user_id, tracking_number)**; index on `(provider, provider_tracker_id)` for webhook lookup.
  - **checkpoints**:
    - Columns: `id`, `shipment_id` (FK cascade), `provider_event_id`, `occurred_at`, `event_order` (int, nullable), `status`, `message`, `location_text`, `lat`, `lng` (double, nullable), `mode` (nullable), `created_at`.
    - Constraints and indexes: **unique (shipment_id, provider_event_id)**; index `(shipment_id, occurred_at)`.
  - **places**: `id`, `query_key` (unique, the normalized location text), `lat`, `lng`, `display_name`, `created_at`.
  - **inbound_emails**: `id`, `user_id` (FK cascade), `received_at`, `raw` (text), `parse_status`, `extracted` (jsonb, nullable), `created_at`. Index on `received_at` for the 30-day cleanup.
- Run `npm run db:generate` to produce the SQL, and commit it with the schema. Applying it to Supabase (`npm run db:migrate`) is a manual step for the user and isn't required for the gate.

Commit: `feat(db): add schema and initial migration`

### 3. PGlite test helper + schema tests — `tests/db/pglite.ts`, `src/lib/db/schema.test.ts`
- `createTestDb()`: create a new in-memory `PGlite`, wrap it with `drizzle(pglite, { schema })`, run `migrate(db, { migrationsFolder: "drizzle" })` and return the db. Each test file gets its own instance.
- Widen the `Db` type in `client.ts` to the shared `PgDatabase` base so query functions accept both postgres-js and PGlite instances.
- Tests:
  - The migrations apply cleanly.
  - A duplicate `(user_id, tracking_number)` is rejected.
  - A duplicate `(shipment_id, provider_event_id)` is rejected.
  - Deleting a user cascades to shipments and checkpoints.
  - Status defaults to `Pending`.

Commit: `test(db): run schema against PGlite`

### 4. Checkpoint insert query — `src/lib/db/checkpoints.ts`
- `insertCheckpoints(db, shipmentId, events: NormalizedEvent[])` inserts with `onConflictDoNothing({ target: [shipment_id, provider_event_id] })` and returns the number of rows actually inserted. This is the DB half of de-duplication.
- PGlite tests:
  - Inserting the same events twice adds nothing the second time.
  - A mixed batch of old and new events inserts only the new ones.

  Phase 3 builds its webhook upsert on top of this. The status-regression logic belongs to Phase 3 and is **not** built here.

Commit: `feat(db): add idempotent checkpoint insert`

### 5. Normalization helpers — `src/lib/tracking/normalize.ts`
- `parseLogisticsDate(s)`: a value with `Z` or an offset is parsed exactly; a value with no offset is treated as UTC; a date-only value becomes 00:00 UTC; anything unparseable throws `ProviderResponseError`.
- `dedupeEvents(events)`: remove events with a repeated `providerEventId` (keep the first), then sort by `occurredAt` desc, then `order` desc.
- `normalizeTrackingNumber(s)`: trim, strip spaces, uppercase. This is shared with Phase 2's form.
- Table-driven tests for each.

Commit: `feat(tracking): add normalization helpers`

### 6. Ship24 status mapping — `src/lib/tracking/ship24/status-map.ts`
- `SHIP24_MILESTONE_TO_STATUS: Record<Ship24Milestone, Status>`:

  | Ship24 milestone | Status |
  | --- | --- |
  | `pending` | `Pending` |
  | `info_received` | `InfoReceived` |
  | `in_transit` | `InTransit` |
  | `out_for_delivery` | `OutForDelivery` |
  | `failed_attempt` | `AttemptFail` |
  | `available_for_pickup` | `AvailableForPickup` |
  | `delivered` | `Delivered` |
  | `exception` | `Exception` |

- `mapShip24Status(milestone, statusCode?)`: an unknown milestone falls back to `Pending` instead of throwing, so new Ship24 values don't break ingestion. A `statusCode` in the `exception_*` family, or `data_order_cancelled`, forces `Exception`.
- Tests:
  - Every milestone.
  - Every documented `statusCode` (listed from the docs), checking the mapped result.
  - The unknown fallback.
  - `Expired` is never produced by Ship24 mapping.

Commit: `feat(tracking): map Ship24 statuses`

### 7. Retry helper — `src/lib/tracking/retry.ts`
- `withRetry(fn, { retries = 3, baseMs = 500, maxMs = 8000, sleep, random })`: exponential back-off with full jitter. It retries only errors whose `retryable` flag is true (429, 5xx, network errors, 409 `request_conflict`) and rethrows the final error. `sleep` and `random` are injected so tests run instantly and deterministically.
- Tests:
  - Succeeds on the 2nd try.
  - Gives up after N retries.
  - Never retries non-retryable errors (401, 400, 403, 404).
  - The delay sequence stays within bounds.

Commit: `feat(tracking): add retry with exponential backoff`

### 8. Ship24 provider — `src/lib/tracking/ship24/{schemas,client,provider}.ts`
- **`schemas.ts`:** zod schemas for the Ship24 tracking, tracker, error body and webhook body. They use `.passthrough()`-free `z.object` (unknown fields are stripped) and nullable fields exactly as the spec defines them.
- **`client.ts`:** `ship24Request(path, init, { apiKey, baseUrl, fetch })`.
  - Builds the Bearer header and sets a 10 s timeout through `AbortSignal.timeout`.
  - Validates bodies with zod.
  - Maps HTTP status and error code to the typed errors.
  - Wraps calls in `withRetry`.
- **`provider.ts`:** `class Ship24Provider implements TrackingProvider`, constructed with `{ apiKey, webhookSecret, baseUrl?, fetch?, sleep? }`.
  - `createTracking`: `POST /trackers/track` with `trackingNumber`, plus `courierCode: [hint]`, `destinationPostCode` and `destinationCountryCode` when given. On `409 tracker_conflict`, fall back to `GET /trackers/search/{trackingNumber}/results` and return the existing tracking. This is the "duplicate tracker" handling.
  - `getTracking`: `GET /trackers/{id}/results`.
  - `deleteTracking`: `PATCH /trackers/{id}` with `{ isSubscribed: false }`.
  - `parseWebhook`:
    - Compare the `Authorization` header with `Bearer ${webhookSecret}` using `crypto.timingSafeEqual`, after a length check. A missing or wrong header throws `WebhookAuthError`.
    - Then `JSON.parse` the raw body, validate it with zod, and normalize each tracking.
  - Mapping a tracking to `NormalizedShipment`:
    - `status` comes from `shipment.statusMilestone` / `statusCode`.
    - `eta` comes from `delivery.estimatedDeliveryDate`, falling back to `courierEstimatedDeliveryDate.to`.
    - `courier` is the first event's `courierCode`.
    - Events go through `dedupeEvents`, and `lastEventAt` = the newest event.
- **Fixtures** in `tests/fixtures/ship24/`. They are hand-built from the OpenAPI examples, because tests never call real Ship24, and each fixture notes where it came from in a sibling `README.md`.
  - `track-in-transit.json`
  - `track-delivered.json`
  - `results-in-transit.json`
  - `search-results.json`
  - `unsubscribe.json`
  - `webhook-events.json` (with a duplicated `eventId`)
  - `error-400-validation.json`
  - `error-401.json`
  - `error-403-quota.json`
  - `error-404.json`
  - `error-409-tracker-conflict.json`
- **MSW handlers** in `tests/msw/ship24-handlers.ts` serve those fixtures.
- **Tests** (`provider.test.ts`):
  - 401 throws `ProviderAuthError` without retrying.
  - 429 twice then 200 succeeds after 3 calls.
  - 429 forever throws `RateLimitedError` after the retry cap.
  - 503 is retried.
  - 400 throws `InvalidTrackingNumberError`.
  - 403 quota throws `QuotaExceededError`.
  - The 409 conflict falls back to the search endpoint.
  - A malformed body throws `ProviderResponseError`.
  - The request carries the Bearer header and the courier hint.
  - The key never appears in error messages.

Commit: `feat(tracking): add Ship24 provider`

### 9. Fake provider — `src/lib/tracking/fake/provider.ts`
- An in-memory, deterministic implementation. The tracking-number prefix picks the scenario:
  - `FAKE-TRANSIT-*`: 3 events, ending InTransit
  - `FAKE-OFD-*`: OutForDelivery
  - `FAKE-DELIVERED-*`: full lifecycle
  - `FAKE-EXCEPTION-*`
  - `FAKE-PENDING-*`: no events
  - `FAKE-AIR-*`: airport checkpoint text, for Phase 4
  - `FAKE-INVALID-*`: throws `InvalidTrackingNumberError`
  - any other number: InTransit
- Event timestamps are relative to an injectable `now()`, and the IDs are stable, e.g. `${trackerId}-e1`.
- Its `parseWebhook` uses the same Bearer check against a configured secret, then accepts `{ trackings: NormalizedShipment-like JSON }` validated by zod.

Commit: `feat(tracking): add fake provider`

### 10. Shared contract suite — `src/lib/tracking/contract.ts`, run from `ship24/contract.test.ts` and `fake/contract.test.ts`
- `runProviderContract(name, setup)`, where `setup` returns `{ provider, validNumber, invalidNumber, unknownTrackerId, webhook: { validBody, validHeaders, duplicateEventBody } }`. Ship24's setup installs MSW handlers.
- Assertions (identical for both providers):
  - `createTracking` returns a `NormalizedShipment` with a non-empty `providerTrackerId`, a valid `Status` and newest-first events.
  - Calling `createTracking` twice with the same number gives the same `providerTrackerId` (idempotent).
  - `getTracking(id)` matches the result of create.
  - An unknown id throws `TrackerNotFoundError`.
  - An invalid number throws `InvalidTrackingNumberError`.
  - `deleteTracking` resolves.
  - `parseWebhook`: valid auth returns shipments; wrong or missing auth throws `WebhookAuthError`; duplicate event ids come back de-duplicated.
  - All output passes a zod `NormalizedShipment` schema.

Commit: `test(tracking): shared provider contract suite`

### 11. Env + provider factory — `src/lib/env.ts`, `src/lib/tracking/index.ts`
- Env adds:
  - `TRACKING_PROVIDER`: `fake` | `ship24`, default `fake`
  - `SHIP24_API_KEY`
  - `SHIP24_WEBHOOK_SECRET`
  - `FAKE_WEBHOOK_SECRET`, default `fake-secret` outside production

  `superRefine` requires both Ship24 keys when `TRACKING_PROVIDER=ship24`, and the error still names keys, never values. Update `.env.example`.
- `getTrackingProvider()` is a lazy singleton chosen by env. It is the **only** place outside `src/lib/tracking/` subfolders that knows provider classes exist, and nothing else imports `ship24/` or `fake/` directly.
- Tests:
  - The factory picks the right class.
  - `ship24` without keys throws a named-key error.
- Lint guard: an ESLint `no-restricted-imports` rule blocks `@/lib/tracking/ship24*` and `@/lib/tracking/fake*` outside `src/lib/tracking/`. This enforces the CLAUDE.md rule mechanically.

Commit: `feat(tracking): select provider from env`

### 12. Docs
Update CLAUDE.md:
- the folder layout (`lib/tracking/{ship24,fake}/`, `tests/db/`, `tests/fixtures/ship24/`)
- note the `parseWebhook` return type and the unsubscribe-as-delete behaviour
- the env keys

Update the `docs/plan.md` interface snippet to match.

Commit: `docs: update for Phase 1`

## Explicitly not in Phase 1

- Webhook route, status-regression rules and jobs (Phase 3)
- Auth, UI and the add form (Phase 2)
- Geocoding and `inferMode` (Phase 4)
- Live Ship24 calls in any test

## Test gate (coverage target 90%)

- Every Ship24 milestone and documented statusCode maps to the right `Status`, with the unknown fallback covered.
- Duplicate events are de-duplicated, both in memory (`dedupeEvents`, webhook payload) and in the DB (unique index + `insertCheckpoints` on PGlite).
- Error responses are handled: 401, 400, 403, 404, 409 conflict fallback, 429 with back-off then success or give-up, 5xx retry, malformed body.
- Both providers pass the shared contract suite.
- `npm run lint`, `npm run typecheck` and `npm run test:coverage` pass locally and in CI, with coverage ≥90% on files touched in Phase 1. Report the numbers.
- Push (ask first), confirm CI is green through the GitHub API (the repo is public), tag `phase-1-done`, and set CLAUDE.md "Current phase" to Phase 2.

## Verification (build session)

1. `npm test`: all suites green, including the PGlite schema tests and both contract runs.
2. `npm run db:generate` produces no new migration after step 2, so the schema and SQL are in sync.
3. Optional, user-run: once a Supabase project exists, `npm run db:migrate` against it creates the 5 tables.
4. Optional, user-run, costs 1 of 10 free Ship24 shipments: with `TRACKING_PROVIDER=ship24` and real keys in `.env.local`, a one-off script calls `createTracking` on a real number. This isn't part of the gate.
