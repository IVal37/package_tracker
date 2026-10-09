# Phase 7 — MVP hardening and launch: plan

## Needs your attention before building

**Two findings from planning**

1. **`docs/launch-audit.md` does not exist.** The spec says to fix every High and Medium item in it, but nobody has written it. Step 1 creates it with a review pass of the whole codebase; its High and Medium items are then fixed in the steps below or in step 15.
2. **A real bug in code that is already shipped.** `removeShipment` always unsubscribes the provider's tracker, but one tracker can be shared by several users' shipments (the same tracking number). If user A deletes a package, user B stops getting updates for theirs. Step 5 fixes it (unsubscribe only when no other shipment uses the tracker). Account deletion (step 11) follows the same rule. It is not urgent while there are few users, but it must be fixed before launch.

**Approval requested: two new packages**

| Package | Step | Why |
| --- | --- | --- |
| `@sentry/nextjs` | 8 | Error reporting (a Phase 7 deliverable) |
| `@playwright/test` (dev) | 14 | The one launch test (the Stack says "Playwright only at launch") |

Approving this plan approves these two and nothing else (details under "Dependencies to approve").

**Also yours to decide or do**

- **Approve changing a security rule:** `docs/supabase-setup.md` says never to use Supabase's secret key. Account deletion needs it, in one import-restricted module (decision below).
- **Review the privacy policy and terms draft** before launch. I write it; it is not legal advice.
- **Do the production setup** in step 15 (Vercel, Supabase, Ship24, Inngest, Cloudflare, Resend, Sentry, a domain), and **start the final Fable sweep** by switching the model. I cannot do these from here.

## Decisions

Decisions (2026-10-09):

- **Expired after 60 quiet days.** A shipment with no tracker event for 60 days (its `created_at` if it never had one) becomes `Expired` and stops being re-fetched. Delivered shipments are never touched. The number is the env value `EXPIRE_AFTER_DAYS` (default 60).
- **Active-package cap: 25 per user** (`ACTIVE_PACKAGE_CAP`, default 25). "Active" means not archived and not Delivered or Expired, because those are the ones that cost tracker quota.
- **Rate limits live in Postgres** (a small counter table), so the limit is shared by every server instance and no new service is needed.
- **Admin page** at `/admin`, open only to the emails in `ADMIN_EMAILS` (anyone else gets a 404).
- **Account deletion removes the sign-in account too**, using Supabase's secret key in exactly one import-restricted module. This changes the rule in `docs/supabase-setup.md` ("never use the secret key") to "only in `src/lib/auth/admin.ts`".
- **The launch test signs in through a small fake auth server**, not a real email. Real Supabase sign-in stays a manual launch-checklist step.
- **Geocoder and map tiles: keep Nominatim and OpenFreeMap for launch** (results are cached forever, so Nominatim only sees new places, at 1 request a second). Revisit if the admin page shows volume. Both are logged risks in the privacy policy and `docs/launch-checklist.md`.

## Goal

Wayfind is safe to put in front of the public: abuse is limited and one user cannot burn the tracker or Claude budget, failures reach a human, people can see, download and delete their data, the legal pages exist, the security headers are on, a launch test proves the main path, and the first production deploy follows a checklist rather than memory. Then the `mvp-launch` tag.

## Facts that shape this design

Read 2026-10-09.

- **`docs/launch-audit.md` does not exist yet**, although the spec says to fix every High and Medium item in it. Step 1 creates it (a structured review of the whole codebase) so there is something to fix.
- **A real bug found while planning:** `removeShipment` always unsubscribes the provider's tracker, but one tracker can be shared by several users' shipments (same tracking number). User A deleting a package would stop updates for user B. Step 5 fixes it (unsubscribe only when no other shipment uses the tracker) and account deletion needs the same rule.
- **Sign-in is Supabase's one-time-code (PKCE) flow** (`/auth/callback?code=`), so a script cannot mint a session. That is why the launch test needs the fake auth server.
- **Every table that holds user data cascades from `users`** (shipments, checkpoints, orders, inbound emails, notifications, settings, push subscriptions). Deleting the user row removes it all; `places` is a global cache with no personal data.
- **The re-fetch job** runs up to 100 trackers one after another in a single step, which may exceed a serverless time limit at volume.
- **`@sentry/nextjs` 11.x supports Next 16** (peer range `^16.0.0-0`).
- **Things only you can do**: buy a domain, create the Vercel project, Supabase production URLs, the paid Ship24 plan and its webhook URL, Inngest app sync, Cloudflare Worker, Resend domain, a Sentry project. They are step 15's checklist; I cannot do them from here.

## Dependencies to approve

| Package | Where | Why |
| --- | --- | --- |
| `@sentry/nextjs` | app | Error reporting (Phase 7 deliverable "Sentry") |
| `@playwright/test` (dev) | app | The one launch test (Stack: "Playwright only at launch") |

The fake auth server uses only Node's built-in `http` and `crypto`. Approving this plan approves these two and nothing else.

## Design decisions

### Rate limiting (`src/lib/ratelimit/`)

- A table `rate_limits (key, window_start, count)`, primary key `(key, window_start)`. One statement, `insert ... on conflict do update set count = count + 1 returning count`, counts a hit atomically for any number of server instances. Fixed windows (a minute or a day) are simple and good enough here.
- `hit(db, { key, limit, windowMs, now })` returns `{ allowed, retryAfterSeconds }`. A daily job deletes windows older than two days.
- What is limited (defaults, each an env-free constant in one table in `limits.ts`):

  | Action | Key | Limit |
  | --- | --- | --- |
  | Request a sign-in link | client IP, and the email | 5 per 10 minutes each |
  | Add a package | user | 10 a minute, 100 a day |
  | Send a test push | user | 3 a minute (replaces the in-memory limiter) |
  | Download my data | user | 3 an hour |
  | Delete my account | user | 3 an hour |
  | Inbound email webhook | the alias it names, after the secret is checked | 10 a minute (the daily cap stays) |

- The client IP comes from the platform's header (`x-real-ip`, falling back to the first `x-forwarded-for`); it is only a rate-limit key, never trusted for anything else. If there is none the key is `unknown`.
- A limited request answers with a clear message (and `429` plus `Retry-After` for route handlers). Logs name the action and never the key.
- Webhooks that authenticate by secret are not limited before the secret check, so a flood of bad requests costs the platform firewall, not the database. Turning on Vercel's firewall rate limit for `/api/webhooks/*` is a launch-checklist item.

### Package cap and the shared-tracker fix

- `addShipment` counts the user's active shipments before calling the provider and returns `limit_reached` at the cap, so a capped user costs no tracker quota. Manual adds and forwarded emails both go through `addShipment`, so both are covered; the email pipeline records the outcome and moves on. The count and the insert are not atomic, so a burst of parallel requests can overshoot by a few. The per-minute add limit bounds that, and it is not worth a lock.
- `removeShipment` (and account deletion) unsubscribe a tracker only when no other shipment, of any user, still uses it.

### `Expired`

- Daily job `expire-quiet-shipments`: set `status = 'Expired'` where the status is not Delivered or Expired, the shipment is not archived, and `coalesce(last_event_at, created_at)` is older than `EXPIRE_AFTER_DAYS`. A new partial index on that expression keeps the scan cheap. Expired shipments are already skipped by the re-fetch (it excludes terminal statuses).
- A tracker that wakes up later and sends a newer event moves the shipment out of `Expired` through the normal event-time rule. That is wanted.
- The existing archive job also archives Expired shipments 14 days after they expired, so the list does not collect dead rows for ever. No alert is sent for expiring.

### Re-fetch fan-out

- `refetch-stale` becomes a thin sweep that finds stale trackers and sends one event per tracker (`wayfind/tracker.refetch`, id per tracker per hour). A new function handles one tracker, with a concurrency limit and a throttle matching Ship24's rate limit. On a bad API key or an exhausted quota it reports the problem once and leaves the tracker stale, and the next hourly sweep tries again; it does not mark trackers as synced, so nothing is hidden for a day. No single run holds up to 100 calls any more.

### Monitoring (Sentry)

- `src/lib/monitoring/`: `reportIssue(kind, details)` and `reportError(error, context)`, with a no-op default when `SENTRY_DSN` is not set (tests and development) and a Sentry implementation behind it, chosen like the other adapters. Only the Sentry adapter imports `@sentry/nextjs`.
- Privacy: `sendDefaultPii` off, a `beforeSend` that drops request bodies, headers, cookies, query strings and any user email, and `details` limited to ids, kinds and counts. Tracking numbers, subjects, addresses and message text are never sent. Tests feed it hostile examples and check what comes out.
- Wired in through `instrumentation.ts` (`register`, `onRequestError`) and a `global-error` page, plus Inngest `onFailure` handlers that report: a job out of retries (`geocode-place`, `process-inbound-email`, `send-notification`), a notification marked `failed`, and the re-fetch stopping on a bad key or quota. Source-map upload is optional (`SENTRY_AUTH_TOKEN`).

### Emails that could not be read

- Settings lists them (sender, subject, date, why), newest 20, each with **Try again** (back to pending and a new event, only for a failed email) and **Dismiss** (deletes the row). Both are `userId`-scoped; another user's email looks like a missing one. Subjects are rendered as text.

### Admin page

- `/admin`, dynamic, `requireUser()` then `ADMIN_EMAILS` (a comma-separated, lower-cased list), otherwise `notFound()`. It shows, from one system-scope module that returns only counts (`src/lib/db/admin-stats.ts`, import-restricted): trackers created per day for the last 30 days against `SHIP24_MONTHLY_ALLOWANCE` (distinct provider trackers, since a shared tracker counts once), the month so far, active shipments, users, emails and notifications that failed in the last 7 days, and the oldest pending email or notification. No shipment contents, no addresses.

### Data export and delete (Settings)

- **Download my data** (`GET /settings/export`, signed in, rate limited): one JSON file with the account (email, alias, created), every shipment with its checkpoints, orders, stored emails (subject, sender, status, and the stored body while it still exists), notification settings, alert history, and the number and age of registered devices (not their keys). All through `userId`-scoped queries in `src/lib/db/export.ts`, with `Content-Disposition: attachment` and `Cache-Control: no-store`.
- **Delete my account** (a typed confirmation, then a server action, rate limited): in order, unsubscribe the user's trackers that no one else uses; delete the user row (everything cascades); delete the Supabase sign-in account with `auth.admin.deleteUser` (`src/lib/auth/admin.ts`, the only user of `SUPABASE_SECRET_KEY`); clear this device; send the person to a "your account is deleted" page. The data goes first on purpose: if the last step failed, an orphan login with no data is harmless, while the reverse would leave data nobody can reach. A failure there is reported and the person is told what happened.

### Legal pages and email

- `/privacy` and `/terms`: public, plain, linked from the sign-in page and the Settings footer. The privacy policy lists every service that sees personal data and what it sees: Supabase (account email), Vercel (hosting), Ship24 (tracking numbers), OpenStreetMap Nominatim (place text only), OpenFreeMap (the visitor's IP via tile requests), Anthropic (forwarded email text), Cloudflare (inbound email routing), Resend (the account email and package name in alerts), Inngest (job payloads: ids only), Sentry (errors with personal details stripped), and the browsers' push services. It also states the retention rules (raw emails 30 days, alert history 90, orders 90) and how to export and delete. **I write a draft; it is not legal advice and the plan's launch checklist has you review it before launch.** The contact address is `SUPPORT_EMAIL`.
- Alert emails get a `List-Unsubscribe: <APP_URL/settings>` header. One-click unsubscribe (a signed link and a POST endpoint) stays in the backlog.

### Security headers

- In `next.config.ts`, for every page: `Strict-Transport-Security`, `X-Content-Type-Options: nosniff`, `X-Frame-Options: DENY`, `Referrer-Policy: strict-origin-when-cross-origin`, `Permissions-Policy` (camera, microphone, geolocation off) and a Content-Security-Policy that allows what the app really uses: its own origin, the map style and tiles host, MapLibre's blob worker, Next's inline hydration scripts, and Supabase only server-side (so not in `connect-src`). It ships as `Content-Security-Policy` after the launch test passes under it; if the test or the map breaks, it ships as `Report-Only` and the exact breakage goes in the audit. The service worker keeps its own stricter policy.

### The launch test

- `npm run e2e` (Playwright, Chromium): sign up, add a package, see it in the list, switch to the map and see its marker. It runs against `next build && next start` with the fake tracking provider, the fake geocoder and a **fake auth server** (`e2e/fake-auth/`): about 150 lines of Node that answer the few Supabase endpoints the app calls (send link, exchange the code, get the user, the signing keys), sign its own tokens with a key generated at start, and hand the test the "email" through a test-only side channel on that server. It is never part of the app and never reachable in production.
- It needs a Postgres: in CI a service container with the real migrations; locally `E2E_DATABASE_URL` (a local Postgres, not the Supabase project). CI runs it as a separate job after the unit job, so a Playwright problem is visible without hiding unit results.

### Env keys (all validated in `src/lib/env.ts`)

| Key | Rule |
| --- | --- |
| `SUPABASE_SECRET_KEY` | server-only; optional, but account deletion refuses without it; required in production |
| `SENTRY_DSN` | optional; no reporting without it |
| `ACTIVE_PACKAGE_CAP` | default 25, 1 to 1000 |
| `EXPIRE_AFTER_DAYS` | default 60, 7 to 365 |
| `ADMIN_EMAILS` | optional; empty means nobody is an admin |
| `SHIP24_MONTHLY_ALLOWANCE` | optional number; the admin page says "not set" without it |
| `SUPPORT_EMAIL` | shown on the legal pages; required in production |

The build hands you the `.env.example` lines, since Claude cannot edit that file.

### System-scope modules

`src/lib/db/admin-stats.ts` (counts only) and `src/lib/auth/admin.ts` (the secret key) are import-restricted by ESLint with guard tests, like the others. Rate limiting is not system-scope: it takes only a key and returns a verdict.

## Steps (one commit each)

1. **Audit** (no feature code): run the code-review and security-review skills over the codebase and write `docs/launch-audit.md`: each finding with severity (High, Medium, Low), where, and what fixes it. High and Medium items are fixed in the steps below or in step 15; Low goes to the final sweep.
   Commit: `docs: launch audit`.
2. **Schema** (own commit; load `supabase-postgres-best-practices` first): `rate_limits` with RLS enabled, a cleanup index; a partial index for the expiry scan. Tests in `schema.test.ts`.
   Commit: `feat(db): rate limit counters and expiry index`.
3. **Env** (+ tests for each rule) and the `.env.example` lines handed over.
   Commit: `feat(env): launch settings`.
4. **Rate limiting:** `src/lib/ratelimit/` and wiring into sign-in, add package, test push, the inbound webhook (and, later, export and delete). Tests on PGlite: limits hold across separate calls, windows roll over, keys are independent, two concurrent hits count exactly once each, cleanup deletes only old windows, the sign-in limit applies per IP and per email, a limited route handler answers 429 with `Retry-After`.
   Commit: `feat(security): database-backed rate limits`.
5. **Cap and shared-tracker fix:** the cap in `addShipment` and the email pipeline's handling; `removeShipment` unsubscribes only unshared trackers. Tests: the cap counts only active shipments, a capped add never calls the provider, emails at the cap record the outcome, deleting a shared package leaves the other user's tracker alone.
   Commit: `feat(shipments): active package cap; keep shared trackers`.
6. **Expired:** the daily job, the archive extension, the tests: Expired only after N quiet days, never for Delivered, never for archived, uses `created_at` when there are no events, excluded from re-fetch, a later event revives it.
   Commit: `feat(jobs): expire quiet shipments`.
7. **Re-fetch fan-out:** sweep plus per-tracker function; tests that one tracker's failure does not affect the others and that a bad key or quota stops the work.
   Commit: `feat(jobs): re-fetch one tracker per event`.
8. **Monitoring:** the adapter, `instrumentation.ts`, `global-error`, the Inngest `onFailure` reports, the scrubbing tests. Install `@sentry/nextjs`.
   Commit: `feat(monitoring): Sentry with personal data stripped`.
9. **Unreadable emails:** the Settings list, Try again, Dismiss. Tests: only the user's own, only failed emails can be retried, text rendering.
   Commit: `feat(ui): see and retry emails that could not be read`.
10. **Admin page:** the stats module, the page, the guard. Tests: non-admins and signed-out users get a 404, counts are right across users, shared trackers count once, no shipment content reaches the page.
    Commit: `feat(admin): tracker usage page`.
11. **Export and delete:** the export route, the delete flow, `src/lib/auth/admin.ts`, the guard test. Tests: the export holds exactly the user's data and nothing of another user's (checked row by row), delete removes every table's rows for that user and only that user, a shared tracker survives, the order of steps, a failed auth deletion is reported and not silent.
    Commit: `feat(privacy): export and delete my data`.
12. **Legal pages:** `/privacy`, `/terms`, links, the `List-Unsubscribe` header. Tests that the pages are public, linked, and name every service in the list above (a test reads the list from one constant so a new service cannot be forgotten).
    Commit: `feat(legal): privacy policy, terms and unsubscribe header`.
13. **Security headers:** `next.config.ts` and a test that every header is present; the CSP as described.
    Commit: `feat(security): response headers and content security policy`.
14. **Launch test:** the fake auth server, the Playwright test, the CI job. Install `@playwright/test`.
    Commit: `test(e2e): sign up, add a package, see it on the list and the map`.
15. **Fixes, checklist, tag** (several commits): fix the audit's High and Medium items; write `docs/launch-checklist.md` (every production setting, the order to do things, how to roll back, what to check after); update CLAUDE.md, `docs/supabase-setup.md` and `docs/unresolved-issues.md`; the final sweep.
    **You then do the deploy** (Vercel, Supabase, Ship24, Inngest, Cloudflare, Resend, Sentry), working through the checklist, and I help with anything that fails. The **final sweep with Fable** is yours to start: switch the model and run a full review; its High and Medium findings are fixed before the tag.
    Tag `mvp-launch` only after the production checks in the checklist pass.

## Explicitly not in Phase 7

- Payments and Stripe (the "Upgrade" button stays a "Coming soon" dialog), AfterShip, native apps, Gmail or Outlook sync (all out of scope for the MVP).
- One-click email unsubscribe, an in-app alert history, offline map or adding offline.
- A hosted geocoder or tile provider (kept as launch risks; the interfaces make it a later swap).
- Making deletion of the Supabase login and the app data one atomic step (the order above makes a failure safe instead).
- A separate production Supabase project or staging environment (a launch-checklist question for you).

## Test gate (coverage target 85% overall)

- **Expired:** set only after N quiet days, never on a Delivered shipment, never on an archived one; excluded from re-fetch.
- **Rate limits hold:** over-limit requests are refused across instances (a shared counter), windows roll over, one user's limit never affects another's.
- **The cap holds, and costs no quota:** a capped add never calls the provider; forwarded emails respect it.
- **Shared trackers are safe:** deleting a package or an account never unsubscribes a tracker another user still follows.
- **Privacy:** the export contains exactly the user's data and nothing of anyone else's; account deletion removes every row of the user and nothing else; the admin page returns counts only and a 404 to everyone else; error reports contain no personal data.
- **Monitoring:** a job out of retries, a failed notification and a stopped re-fetch each produce one report.
- **Headers and pages:** every security header is present; `/privacy` and `/terms` are public and name every service.
- **Launch test (Playwright):** sign up, add a package, see it in the list and on the map. Runs in CI.
- **Checks:** `npm run lint`, `typecheck`, `test:coverage` (at least 85% overall; report the numbers), `build` and `npm run e2e` pass locally and in CI.
- **Finish:** the audit's High and Medium items fixed and ticked in `docs/launch-audit.md`; every Phase 7 item in `docs/unresolved-issues.md` resolved or moved with a reason; production checks pass; push (ask first), confirm CI through the GitHub API, tag `mvp-launch`, set CLAUDE.md to "launched". List deferred items in the summary.

## Verification (build session)

1. `npm test` and `npm run e2e` are green.
2. **Manual, locally** (fake providers): hit the sign-in limit and see the message; add packages up to a cap of 3 (set `ACTIVE_PACKAGE_CAP=3`) and see the refusal; run the expiry job from the Inngest UI against a package backdated 61 days; open Settings and download your data; view `/admin` as an admin and as someone else (404); delete a test account and check the database is empty of it; open `/privacy` and `/terms` signed out.
3. **Production** (needs your deploy): follow `docs/launch-checklist.md`: send a real Ship24 test webhook, confirm the Inngest functions sync and the crons fire, add a real tracking number, sign in with a real magic link and Google, forward a real email, receive a real push and a real alert email, and trigger a deliberate error to see it in Sentry without personal data.
