# Wayfind — Build Plan

This is the full spec for the MVP. `CLAUDE.md` holds the always-on rules; this file holds the detail for each phase. Work one phase at a time.

## 1. Product

**What it is:** a web app (installable PWA) where people see every incoming package in one place: a sortable list and a map with truck, plane, ship and van icons showing where each parcel is and how it is moving.

**How packages get in:**

1. Typed or pasted tracking number (courier auto-detected).
2. Forwarded order/shipping emails sent to the user's private Wayfind address, parsed automatically.

**MVP scope (Phases 0–7):** accounts, manual add, carrier auto-detect, list view, map view with transport-mode icons, live updates via webhooks, email-forward auto-capture, push and email alerts, deployed publicly on Ship24.

**Not in the MVP:** payments (an "Upgrade — coming soon" button only), AfterShip, native apps, Gmail/Outlook OAuth sync.

## 2. Tracking provider

### Ship24 (MVP)

| Topic | Detail |
| --- | --- |
| Docs | https://docs.ship24.com |
| OpenAPI spec | https://docs.ship24.com/assets/openapi/ship24-tracking-api.yaml |
| Base URL | `https://api.ship24.com/public/v1` |
| Endpoints | `POST /trackers`, `POST /trackers/track` (create + results in one call), `POST /trackers/bulk` (up to 100), `GET /trackers/{trackerId}/results`, `GET /trackers/search/{trackingNumber}/results` |
| Courier detection | Automatic from the tracking number; `courierCode` is an optional hint. Some couriers also need destination postcode or country. |
| Event data | Each event has status, status code, milestone and a location text field. Location is text, so the app geocodes it for the map. |
| Webhooks | New events are pushed to a URL configured in the Ship24 dashboard; the dashboard can send a test message. Authenticate them as Ship24's webhook docs describe. |
| SDK | Official TypeScript SDK `ship24-node` (or plain `fetch`) |
| Free tier | 10 shipments/month with API and webhooks; paid plan at launch |
| Caveat | Some couriers only return events from the moment the tracker is created |

### AfterShip (later, not in MVP)

Only added if users hit coverage or ETA gaps. Tracking API version 2026-07, key in the `as-api-key` header, webhooks signed with `aftership-hmac-sha256` (base64 HMAC-SHA256 of the raw body). It must plug into the same `TrackingProvider` interface, so nothing Ship24-specific may leak out of the adapter.

## 3. Architecture

### Request flow

1. Manual adds and forwarded emails hit the Next.js API (auth + per-user package limit).
2. The API calls the `TrackingProvider` adapter, which calls Ship24 (or the fake provider in dev/tests).
3. Ship24 webhooks deliver status updates; events are upserted into Postgres.
4. Background jobs re-poll quiet shipments, archive delivered ones and send notifications.
5. The list view, map view and alerts read from Postgres.

### Data model (starting point; Phase 1 finalizes it)

- `users` — id, email, created_at, forwarding_alias
- `shipments` — id, user_id, tracking_number, courier, nickname, provider, provider_tracker_id, status, eta, last_event_at, archived_at, created_at. Unique on (user_id, tracking_number).
- `checkpoints` — id, shipment_id, provider_event_id (unique per shipment, for de-duplication), occurred_at, status, message, location_text, lat, lng, mode
- `places` — normalized location text → lat/lng geocode cache
- `inbound_emails` — id, user_id, received_at, raw (deleted after 30 days), parse_status, extracted JSON

### TrackingProvider interface (starting point)

```ts
interface TrackingProvider {
  createTracking(input: { trackingNumber: string; courierHint?: string; destinationPostCode?: string; destinationCountryCode?: string }): Promise<NormalizedShipment>;
  getTracking(providerTrackerId: string): Promise<NormalizedShipment>;
  deleteTracking(providerTrackerId: string): Promise<void>;
  // Authenticates first (throws WebhookAuthError); one NormalizedShipment per tracking in the webhook.
  parseWebhook(rawBody: string, headers: Headers): Promise<NormalizedShipment[]>;
}
```

`deleteTracking` unsubscribes the tracker on Ship24 (no delete endpoint). Implementations: `Ship24Provider`, `FakeProvider` (canned data for tests and local dev). Chosen with the `TRACKING_PROVIDER` env var.

### Transport-mode inference (`inferMode()`)

Returns `truck`, `plane`, `ship`, `van` or `pin`:

- **van:** status is OutForDelivery.
- **plane:** checkpoint text mentions airport, air gateway or an international departure, or two hops more than ~800 km apart within 24 hours.
- **ship:** text mentions port, vessel or ocean freight.
- **truck:** default for in-transit ground movement.
- **pin:** nothing can be geocoded; show the destination instead.

The detail drawer labels the mode as a "best guess."

## 4. Phases

Every Test gate means: Vitest unit tests for each new module, external services mocked with MSW and fixtures, `npm test` green in CI, coverage at or above the phase target on files touched in that phase, and a `phase-N-done` git tag.

### Phase 0 — Foundation

- **Goal:** an empty but fully wired project.
- **Deliverables:** Next.js + TypeScript scaffold, ESLint/Prettier, Vitest + Testing Library + MSW, GitHub Actions running lint and tests on every push, typed env loader, Postgres connection module, `.env.example`, Commands section of `CLAUDE.md` filled in.
- **Decision to ask about:** Supabase vs Neon.
- **Test gate:** env loader throws a clear error on a missing key; DB module connects with a test URL (mocked if needed); a sample component renders.

### Phase 1 — Data model and tracking-provider adapter

- **Goal:** the schema and a provider layer everything else builds on.
- **Deliverables:** Drizzle schema + migrations (own commit); `TrackingProvider` interface; `Ship24Provider`; `FakeProvider`; Ship24-to-`Status` mapping table; handling of 401, 429 (retry with backoff) and duplicate-tracker responses.
- **Test gate (90%):** every Ship24 status maps correctly; duplicate events are de-duplicated; error responses handled; both providers pass one shared contract test suite.

### Phase 2 — Accounts, manual add, list view

- **Goal:** a signed-in user can add packages and see them in a list.
- **Deliverables:** sign-in (email magic link + Google); ownership checks on every shipments query and mutation; Add Package form (strip spaces, reject duplicates for the same user, optional nickname); list grouped by status, sorted by ETA, with status chips and last checkpoint; detail drawer with full timeline; header "Upgrade" button that only opens a "Coming soon" dialog.
- **Test gate (85%):** no user can read or delete another user's shipment; validation and duplicate rejection; grouping/sorting functions; each status renders the right chip; Upgrade button opens the dialog and makes no network calls.

### Phase 3 — Live updates

- **Goal:** shipments update on their own.
- **Deliverables:** Ship24 webhook route (authenticated per Ship24 docs, raw body, fast 2xx, heavy work queued); idempotent event upserts; status never moves backwards on out-of-order events; job that re-fetches shipments with no update in 24 hours; job that archives shipments delivered 14+ days ago.
- **Test gate (90%):** authentic webhook accepted; tampered/unauthenticated rejected; duplicate delivery creates no duplicate events; late older event doesn't regress status; re-fetch job picks only stale, non-archived shipments; archive job only touches 14+ day deliveries.

### Phase 4 — Map view and transport-mode icons

- **Goal:** the map with moving icons.
- **Deliverables:** cache-first geocoder writing to `places`; `inferMode()`; SVG icons per mode; MapLibre map with route lines through past checkpoints, clustering and an icon at the latest location; List/Map toggle; tapping an icon opens the detail drawer.
- **Test gate (85%):** table-driven `inferMode()` tests with 30+ realistic checkpoint strings and hop distances; geocoder checks cache first and stores new results; no-location shipments fall back to a destination pin; correct icon per mode.

### Phase 5 — Auto-capture by email forwarding

- **Goal:** forwarding an order email adds the package automatically.
- **Deliverables:** private forwarding address per user (e.g. `name-7f3k@in.wayfind.app`) and a settings page with Gmail/Outlook filter setup steps; inbound email webhook; mail to unknown addresses dropped; regex pass for known carrier formats; Claude Haiku 4.5 extraction (retailer, item, order number, tracking number) into schema-validated JSON; "Ordered" placeholders that attach when the shipping email arrives; 30-day raw email deletion job. Shipments created only through `TrackingProvider`.
- **Test gate (90%):** fixtures from 10+ retailers (Amazon, Target, Walmart, eBay, several Shopify stores) extract correctly; malformed model output rejected; unknown address dropped; injected instructions in an email cannot affect another user; placeholders attach to the later email; old raw emails deleted.

### Phase 6 — Notifications and installable PWA

- **Goal:** users hear about important changes and can install the app.
- **Deliverables:** notifications for out for delivery, delivered, exception and delay; per-user settings and quiet hours; web push (VAPID) and email (Resend), sent from jobs only; PWA manifest, icons, offline cache of the list, install prompt.
- **Test gate (80%):** each rule fires exactly once per event; quiet hours and settings respected; service worker caches the list route.

### Phase 7 — MVP hardening and launch

- **Goal:** safe to put in front of the public.
- **Deliverables:** fixes for every High/Medium item in `docs/launch-audit.md`; rate limiting on public endpoints; Sentry; admin page of trackers created per day vs the Ship24 allowance; configurable active-package cap per user; privacy policy and terms pages; data export and delete in settings; Vercel deploy with the production Ship24 webhook.
- **Test gate (85% overall):** full suite green plus one Playwright happy path: sign up, add a package, see it in the list and on the map. Tag `mvp-launch`.

## 5. Backlog (do not build during the MVP)

- **Monetization:** Free and Plus tiers, entitlement checks on every tracking-creation path, Stripe Checkout + Customer Portal, subscriptions synced from signature-verified Stripe webhooks; replaces the "Coming soon" dialog.
- **AfterShip upgrade:** `AfterShipProvider` passing the same contract tests, selectable per user tier.
- **Native apps:** Capacitor or React Native wrappers.
- **Gmail/Outlook inbox sync:** only once revenue covers Google's restricted-scope security assessment.

## 6. Risks to keep in mind while building

- Ship24's free tier is 10 shipments/month: use the fake provider for development and tests.
- Event locations can be missing or vague: always have the destination-pin fallback.
- Forwarded emails are untrusted input: schema-validate everything the model returns.
- Personal data (addresses, purchases): store only what's needed and support export/delete.

## 7. References

- Ship24 docs: https://docs.ship24.com
- Ship24 couriers: https://docs.ship24.com/couriers
- Ship24 webhooks: https://docs.ship24.com/webhooks/overview
- Ship24 AI integration and MCP server: https://docs.ship24.com/integrate-with-ai
- AfterShip Tracking API (later): https://www.aftership.com/docs/tracking
