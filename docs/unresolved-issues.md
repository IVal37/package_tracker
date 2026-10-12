# Unresolved issues and minor bugs

Things found during a phase that are not pressing and do not block development, but should be tested or fixed before shipping. Each one either targets a later phase (where it is picked up as part of that phase) or waits for the **final sweep**, a full review with Fable before launch.

Rule (also in `CLAUDE.md`): do not fix these mid-phase. Add the item here, say so in the end-of-phase summary, and carry on. Remove an item (or mark it done with the commit) when it is resolved.

**Status after the final sweep (2026-10-12):** every item is resolved, moved to the launch checklist (it needs the real services), or accepted for launch with a reason. Nothing is left unclassified. The sweep itself is written up in `docs/launch-audit.md`, "Final sweep".

## Targeted at a later phase

None.

## Resolved in the final sweep

| Item | Found in | Resolved by |
| --- | --- | --- |
| A number re-added after its last follower deleted it got no webhooks: Ship24's `/trackers/track` returns the existing tracker as a normal success, and the re-subscribe only ran on the 409 path | Final sweep (follow-up to launch audit M3) | `df3dfbf` |
| An archived tracking number can never be added again (L1) | Phase 7 | `8c63ef2`: the new package replaces the archived one in the insert transaction |
| A Delivered package past its ETA shows "Overdue" (L2) | Phase 7 | `9cea479`: settled statuses show the plain date |
| "Strong" carrier-format numbers are scanned in the raw HTML and added without the model (L3) | Phase 7 | `32b3499`: scanned in the visible text only (link targets kept) |
| A place that fails to geocode for good could crowd new places out of a sweep (L4) | Phase 4, 7 | `a86045a`: newest places first. The daily retry of a failed place is kept on purpose: it heals once a service-side problem is fixed. |
| The hourly email sweep can start a second run for an email whose first run is waiting to retry (L6) | Phase 7 | `4ffa205`: singleton per email, as `send-notification` |
| The full test suite is occasionally killed by a crashing Vitest worker on Windows, and a lint-guard case times out under load (L7) | Phase 6, 7 | `d1a6281`: workers capped at 8, ESLint loaded once before the guard cases |
| A deleted account can come back as an empty row from another device | Phase 7 | `fd86a11`: it was not harmless (the row held the deleted email and got a new alias). The row is now created only at sign-in; elsewhere `requireLiveAccount` signs such a session out. |
| `next dev` appends a "This is NOT the Next.js you know" block to `CLAUDE.md` on every run | Phase 3 | Committed the block as Next generates it (it points agents at the version-matched docs). Next no longer rewrites the file. |

## Resolved in Phase 7

| Item | Found in | Resolved by |
| --- | --- | --- |
| Re-fetch handles up to 100 trackers one after another inside a single step | Phase 3 | `247473b`: one event per tracker, throttled |
| No alert when the re-fetch job stops early on a bad API key or exhausted quota | Phase 3 | `247473b` (hourly breaker) and `a70be33` (reported once to Sentry) |
| `Expired` is never set | Phase 3 | `737630a` |
| Privacy policy must say location text goes to OpenStreetMap and map tiles to OpenFreeMap | Phase 4 | `2fc5049` |
| A place whose geocode job failed for good: add an alert | Phase 4 | `a70be33` (`geocode-place` reports when out of retries) |
| Privacy policy must say forwarded email goes to Anthropic and Cloudflare and is kept 30 days | Phase 5 | `2fc5049` |
| Emails that could not be read show only as a count | Phase 5 | `a804f4b` (list, Try again, Dismiss) and `a70be33` (alert when `process-inbound-email` gives up) |
| Per-user package cap and rate limiting beyond `INBOUND_DAILY_LIMIT` | Phase 5 | `d470142` (cap) and `2a8d2b0` (rate limits, including 10 a minute per forwarding address) |
| The "Send a test" limit is counted in memory, per server instance | Phase 6 | `2a8d2b0` (counted in Postgres) |
| No alert when a notification fails for good | Phase 6 | `a70be33` |
| Alert emails have no `List-Unsubscribe` header | Phase 6 | `2fc5049` (points at Settings; one-click unsubscribe stays in the backlog) |
| Privacy policy must cover Resend, push services, stored devices and the saved list | Phase 6 | `2fc5049` |
| An alert held through quiet hours can be queued up to about nine times by the hourly sweep | Phase 6 | `24ceaeb`. It was not harmless: the runs could each send the push (launch audit M1). |

## Moved to the launch checklist

These need the real services, so they are production checks in `docs/launch-checklist.md` rather than code.

| Item | Found in | Where |
| --- | --- | --- |
| Verify the webhook against a real Ship24 delivery and the dashboard test message | Phase 3 | Sections 5 and 8 ("Ship24 webhook") |
| End-to-end check of a webhook updating a real signed-in user's package | Phase 3 | Section 8 ("Ship24 webhook"): the real path on the deployed app. Unit tests cover the logic. |
| Verify Inngest in production: app sync, signing key, cron schedules firing (13 jobs and 3 failure handlers) | Phase 3, 5, 6 | Section 4 |
| Check `step.sleepUntil` (quiet hours, up to about 23 hours) is allowed on the Inngest plan in use | Phase 6 | Section 4 |
| Real push on a deployed HTTPS site and on an installed iPhone; real alert emails; real forwarding end to end | Phase 5, 6 | Section 8 |
| The map has been checked in a real browser locally and in the launch test (tiles stubbed), not on a deployed URL with real tiles | Phase 4, 7 | Section 8 ("Map") |
| What Claude Haiku 4.5 actually extracts from real order and shipping emails is untested | Phase 5 | Section 2: run `npm run eval:email` with redacted real emails before setting `EMAIL_EXTRACTOR=claude` |
| The Cloudflare Worker has never been deployed or run against Cloudflare (its `429` try-again path is unit tested only) | Phase 5, 7 | Section 7 |

## Accepted for launch

Known and deliberate. None loses data or exposes it. Items marked "backlog" are listed under "Post-launch polish" in `docs/plan.md`.

| Item | Found in | Why it is acceptable |
| --- | --- | --- |
| No live refresh of the list when a webhook arrives | Phase 3 | The page shows new data on the next load; alerts cover what matters. Backlog. |
| Nominatim's public instance is for light use | Phase 4 | Phase 7 decision: results are cached forever, so it sees only new places, at 1 a second. Named in the privacy policy. Revisit if `/admin` shows volume; `Geocoder` is an interface, so a hosted one is a new adapter. |
| OpenFreeMap tiles have no SLA | Phase 4 | Phase 7 decision. Switching means `MAP_STYLE_URL` and the CSP's `MAP_ORIGIN` (`src/lib/security/headers.ts`). |
| Place names are ambiguous without a country: "PARIS, TX" vs Paris, France; "PORTLAND" | Phase 4 | Nominatim's best guess is usually right for a courier's own spelling. Backlog: bias by the destination country. |
| A destination that is only a country pins at the country's centre | Phase 4 | Ship24 often knows just `destinationCountryCode`; a rough pin is better than none. Backlog: label it. |
| In development, adding a package waits up to 2 seconds if the Inngest dev server isn't running | Phase 4 | Development only. `docs/local-quickstart.md` runs `npm run jobs:dev` alongside `npm run dev`. |
| The map is rebuilt (brief flash) whenever its data changes | Phase 4 | Intended trade-off for simplicity. Backlog. |
| After a session expires without a sign-out, the saved package list stays on the device until the sign-in page is next opened | Phase 6 | Signing out, opening the sign-in page and deleting the account clear it, and the push subscription is claimed by whoever opens Settings next (`586beb8`). The list is only readable on that device. |
| The allow-list of push services may need extending if a browser uses another | Phase 6 | Covers Chrome, Firefox, Edge and Safari today. A new one is a line in `PUSH_SERVICE_SUFFIXES` (`src/lib/notifications/subscription.ts`). |
| One failed device does not retry if another device was reached in the same run | Phase 6 | Intended, so the working device is not buzzed twice. |
| Changing the VAPID keys invalidates every device's push subscription | Phase 6 | The launch checklist says to keep them for good. |
| Webhook bodies are read in full before the secret is checked (L5) | Phase 7 | Bounded by Vercel's 4.5 MB request limit, and the checklist's firewall rule stops floods at the edge. The check itself is constant-time and cheap. Backlog. |
| The CSP allows inline scripts | Phase 7 | Next's hydration scripts are inline. A nonce-based policy needs every page rendered per request and a careful look at the static icons and manifest. Everything else in the CSP is strict. Backlog. |
| Sentry gets no source maps | Phase 7 | Stack traces point at the built server code but still name the file and function. Uploading needs `withSentryConfig` and a `SENTRY_AUTH_TOKEN`. Backlog. |
| Errors that happen only in the browser are reported by class name only | Phase 7 | By design: no Sentry browser SDK keeps the DSN and any page text out of the browser. |
| `/admin` counts trackers from the packages still stored | Phase 7 | Deleted packages drop out, so it can undercount what Ship24 bills. Ship24's own dashboard is the source of truth; the page says so. |
| Unsubscribing a tracker can race with someone adding the same number | Phase 7 | Needs the last follower to delete at the same moment someone adds the number. Adding a known number now always subscribes it again (`df3dfbf`, `0863179`), and the hourly re-fetch covers the gap. |
| Rate limits use fixed windows | Phase 7 | A burst across a window boundary can reach twice the limit. Fine for these numbers. |
| The launch test stubs OpenFreeMap | Phase 7 | It checks the map draws its own marker under the real CSP; the deployed "Map" check confirms real tiles. Locally it needs a throwaway Postgres (`E2E_DATABASE_URL`). |
