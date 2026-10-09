# Unresolved issues and minor bugs

Things found during a phase that are not pressing and do not block development, but should be tested or fixed before shipping. Each one either targets a later phase (where it is picked up as part of that phase) or waits for the **final sweep**, a full review with Fable before launch.

Rule (also in `CLAUDE.md`): do not fix these mid-phase. Add the item here, say so in the end-of-phase summary, and carry on. Remove an item (or mark it done with the commit) when it is resolved.

## Targeted at a later phase

| Item | Found in | Target | Notes |
| --- | --- | --- | --- |
| Verify the webhook against a real Ship24 delivery and the dashboard test message | Phase 3 | Phase 7 | Tested only against the OpenAPI example fixture and the fake provider. Needs a public URL. |
| Verify Inngest in production: app sync at `/api/inngest`, signing key, both cron schedules firing | Phase 3 | Phase 7 | Only checked in dev mode (`function_count: 2`). |
| Re-fetch handles up to 100 trackers one after another inside a single step | Phase 3 | Phase 7 | May run past a serverless time limit once there is volume. Fix by fanning out one event per tracker, or lowering the batch. |
| No alert when the re-fetch job stops early on a bad API key or exhausted quota | Phase 3 | Phase 7 (Sentry) | Today it only returns `stoppedEarly: true` in the run output. |
| `Expired` is never set | Phase 3 | Phase 7 | Already in the Phase 7 deliverables in `docs/plan.md`. |
| Nominatim's public instance is for light use; decide on a hosted geocoder before launch | Phase 4 | Phase 7 | `Geocoder` is an interface, so this is a new adapter plus `GEOCODER` value. Results are cached forever, so volume is only new places. |
| OpenFreeMap tiles have no SLA | Phase 4 | Phase 7 | Community-run. If it matters at launch, switch `MAP_STYLE_URL` in `src/lib/geo/map-style.ts` to a hosted style (a key would then be sent to the browser). |
| Privacy policy must say location text goes to OpenStreetMap (geocoding) and map tile requests go to OpenFreeMap (the visitor's IP) | Phase 4 | Phase 7 | Only place text is sent to the geocoder: never names, street addresses or tracking numbers. |
| A place whose geocode job failed for good is not queued again for up to 24 hours | Phase 4 | Phase 7 | Event ids are de-duplicated for 24 h. Add an alert (Sentry) for exhausted `geocode-place` retries. |
| Privacy policy must say forwarded email text is sent to Anthropic (Claude) for reading and passes through Cloudflare, and that raw emails are kept 30 days | Phase 5 | Phase 7 | The model sees the email body, which can hold names and addresses. Nothing from an email is sent to the geocoder. |
| Verify the three email jobs in production Inngest: `process-inbound-email`, `inbound-email-sweep` (hourly) and `inbound-email-cleanup` (daily) | Phase 5 | Phase 7 | Only run in tests and the dev server so far. |
| Emails that could not be read show only as a count in Settings; no way to see or reprocess them | Phase 5 | Phase 7 | Also add an alert (Sentry) when `process-inbound-email` exhausts its retries. |
| Per-user package cap and rate limiting beyond `INBOUND_DAILY_LIMIT` | Phase 5 | Phase 7 | Anyone who learns an alias can email it, so until then the daily cap is the only control on the Claude bill. |
| Verify the three notification jobs in production Inngest: `send-notification`, `notifications-sweep` (hourly, :25) and `notifications-cleanup` (daily) | Phase 6 | Phase 7 | Only run in tests and the dev server so far. Check that `step.sleepUntil` for quiet hours is allowed on the plan in use (a sleep can last up to about 23 hours). |
| The "Send a test" limit (3 a minute) is counted in memory, per server instance | Phase 6 | Phase 7 | On a serverless host each instance counts for itself, so the limit is only approximate. Replace with the real rate limiting for public endpoints. |
| No alert when a notification fails for good (marked `failed`, or a job out of retries) | Phase 6 | Phase 7 (Sentry) | Today it shows only as the run's result in Inngest and as `status = failed` on the `notifications` row. |
| Alert emails have no `List-Unsubscribe` header; they link to Settings instead | Phase 6 | Phase 7 | Do it with the privacy policy and terms. |
| Privacy policy must say alerts are sent through Resend (the account email address and the package name leave our servers), that push goes through each browser's push service, and that devices are stored by endpoint | Phase 6 | Phase 7 | Also that the saved package list lives on the user's device until they sign out. |

## Final sweep (no phase yet)

| Item | Found in | Notes |
| --- | --- | --- |
| End-to-end check of a webhook updating a real signed-in user's package | Phase 3 | Unit tests cover the logic and a signed-out smoke test covered the routing; the signed-in path (add `FAKE-TRANSIT-1`, `curl` the fixture, reload) was not run by hand. |
| `next dev` appends a "This is NOT the Next.js you know" block to `CLAUDE.md` on every run | Phase 3 | Generated by Next.js. Decide whether to commit it or stop it being written. |
| No live refresh of the list when a webhook arrives | Phase 3 | The page shows new data on the next load. Out of scope for the MVP; revisit if it feels stale. |
| The map has been checked in a real browser (headless Chrome) on the dev server and on a local production build (`next start`), but not on a deployed URL | Phase 4 | Verified: all five icons, route lines (including across the Pacific), clusters with count labels, the basemap, and that `prebuild` recreates the worker in `public/`. Still to check on Vercel: the worker file is served as JavaScript. Automated tests mock MapLibre because jsdom has no WebGL. |
| Nothing in CI would notice the map going blank again | Phase 4 | The MapLibre worker bug (found and fixed in Phase 4) passed every unit test. A single Playwright check in Phase 7 ("open the map, see an icon") would catch this class of failure. |
| Place names are ambiguous without a country: "PARIS, TX" vs Paris, France; "PORTLAND" | Phase 4 | Nominatim picks its best guess. Could bias by the destination country. |
| A destination that is only a country pins at the country's centre | Phase 4 | Ship24 often knows just `destinationCountryCode`. Fine as a rough pin; consider hiding it or labelling it. |
| In development, adding a package waits up to 2 seconds if the Inngest dev server isn't running | Phase 4 | `requestGeocoding()` gives up after 2 s and logs a warning. Run `npm run jobs:dev` alongside `npm run dev`. |
| The map is rebuilt (brief flash) whenever its data changes | Phase 4 | Intended trade-off for simplicity; a webhook arriving mid-view re-renders only on the next navigation anyway. |
| What Claude Haiku 4.5 actually extracts from real order and shipping emails is untested | Phase 5 | The automated tests use a mocked model. Run `npm run eval:email` (a few cents; needs `ANTHROPIC_API_KEY`) with real example emails the user offered to share. Put redacted `.eml` or text files in `tests/fixtures/email/real/` (gitignored) so personal details are never committed; remove names, street addresses and phone numbers first. Also confirms the structured-output schema works with the installed Zod version. |
| The Cloudflare Worker has never been deployed or run against Cloudflare | Phase 5 | Only its pure `handler.ts` is unit tested, and `index.ts` type-checks against Cloudflare's types. `npm install` in `workers/inbound-email/` warns that the `esbuild` and `workerd` install scripts were not run; the setup doc says to allow them before `wrangler deploy`. |
| Real email forwarding hasn't been tried end to end | Phase 5 | Needs a domain and the Cloudflare Worker deployed (`docs/email-forwarding-setup.md`). Includes Gmail's forwarding-confirmation step. |
| The notification UI, install prompt, service worker and offline banner have not been tried in a real browser or on a real device | Phase 6 | Covered by unit tests (the service worker runs in a Node sandbox with a fake Cache API; components use mocked browser APIs). The manual checks in `docs/notifications-setup.md` (Chrome offline reload, a real push, install) are still to do. |
| Real push on a deployed HTTPS site, and on an iPhone installed to the Home Screen, has not been tried | Phase 6 | Needs a deployed URL. iOS push only works for an installed app. |
| Real alert emails have not been sent | Phase 6 | Needs a domain verified in Resend (`docs/notifications-setup.md`). The Resend adapter is tested against a mocked API only. |
| After a session expires without a sign-out, the saved package list stays on the device until the sign-in page is next opened | Phase 6 | Someone else using that device offline in between could see it. Signing out, and opening the sign-in page, clear it. |
| The allow-list of push services (Google, Mozilla, Microsoft, Apple) may need extending if a browser uses another | Phase 6 | `PUSH_SERVICE_SUFFIXES` in `src/lib/notifications/subscription.ts`. A rejected subscription shows "This browser's push service isn't supported". |
| One failed device does not retry if another device was reached in the same run | Phase 6 | Intended, so the working device is not buzzed twice (alerts for a shipment share a tag, so a repeat would replace rather than stack). The failed device misses that one alert. |
| An alert held through quiet hours can be queued up to about nine times by the hourly sweep | Phase 6 | They wait behind the sleeping run and then skip as `not_pending`. Harmless, only wasteful. A quiet-hours window longer than about 23 hours makes every alert go stale. |
| Changing the VAPID keys invalidates every device's push subscription | Phase 6 | Users would have to turn push off and on again. Keep the keys. |
| The full test suite is occasionally killed by a crashing Vitest worker on Windows (exit code 2147483651 while a worker starts, a different file each time) | Phase 6 | Seen twice under the full parallel run on a developer machine; the same code passes on re-run and in CI so far. Likely a limit on many WASM (PGlite) workers starting at once. If it appears in CI, cap `maxWorkers`. |
