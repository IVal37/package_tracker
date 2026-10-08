# Webhooks and background jobs: setup

Phase 3 adds a tracking webhook and two Inngest jobs. Local development needs nothing beyond the fake provider. These steps are for the real services.

## Local development (fake provider)

1. Add `INNGEST_DEV=1` to `.env.local`. `INNGEST_SIGNING_KEY` is not needed locally.
2. Run `npm run dev` in one terminal and `npm run jobs:dev` in another. The Inngest UI is at http://localhost:8288.
3. In the UI, open Functions and invoke `refetch-stale-shipments` or `archive-delivered-shipments` by hand. The output shows the counts each returned.

### Send a fake webhook

With `TRACKING_PROVIDER=fake`, the webhook secret is `FAKE_WEBHOOK_SECRET` (default `fake-secret`).

1. Add the package `FAKE-TRANSIT-1` in the app.
2. Send the saved webhook, which moves it to "Out for delivery":

```powershell
curl.exe -X POST http://localhost:3000/api/webhooks/tracking `
  -H "Authorization: Bearer fake-secret" `
  -H "Content-Type: application/json" `
  --data-binary "@tests/fixtures/fake/webhook-ofd.json"
```

Expected: HTTP 200 and the list shows "Out for delivery" after a reload. Send it again: still 200, no duplicate in the timeline. Leave the header off: 401.

The fixture's events are dated 2099 so they are always newer than the fake data. A later event with an older date is stored in the timeline but never changes the status.

## Ship24 (when you switch to the real provider)

1. In the Ship24 dashboard, open the webhook settings and set the URL to `<APP_URL>/api/webhooks/tracking`. It must be publicly reachable: a Vercel deploy, or a tunnel while testing locally.
2. Copy the webhook secret Ship24 shows there into `SHIP24_WEBHOOK_SECRET`. Ship24 sends it as `Authorization: Bearer <secret>`; there is no signature or IP allowlist.
3. Set `TRACKING_PROVIDER=ship24` and `SHIP24_API_KEY`.
4. Use the dashboard's test message. Expected: a 200 response. A test message for a tracker nobody follows is a 200 on purpose, so Ship24 does not retry it.

Ship24 retries any non-2xx response up to 20 times, and may deliver out of order. The webhook handles both.

## Inngest (production)

1. Create an account at https://www.inngest.com and an app for this project.
2. Easiest: install the Inngest integration for your Vercel project; it sets `INNGEST_SIGNING_KEY` and `INNGEST_EVENT_KEY` for you. Otherwise copy both keys from the Inngest dashboard into the Vercel environment variables of the same names. The event key lets the app send events (geocoding requests).
3. Deploy, then in the Inngest dashboard sync the app at `<APP_URL>/api/inngest`. All four functions should appear (two with cron schedules).
4. `INNGEST_SIGNING_KEY` and `INNGEST_EVENT_KEY` are required in production. If either is missing, the app reports an error that names the missing key.

Free tier: 50,000 step runs a month. The cron jobs use about 1,500; each newly seen place costs 1 more.

## What the jobs do

| Job | Schedule | Effect |
| --- | --- | --- |
| `refetch-stale-shipments` | hourly | Fetches up to 100 trackers whose shipments had no provider update for 24 hours, oldest first, and applies what comes back. Stops on rate limiting, an outage, a bad API key or an exhausted quota, and tries again next hour. |
| `archive-delivered-shipments` | daily 03:30 UTC | Archives shipments delivered 14 or more days ago. |
| `geocode-sweep` | on `wayfind/geocode.requested`, and hourly at :15 | Finds place text (checkpoint locations and destinations of live shipments) with no cached coordinates and queues one `wayfind/place.geocode` event per place, at most 200 a run. The event is sent when a package is added, when a webhook or re-fetch brings new checkpoints; the hourly run is the backstop if a send failed. |
| `geocode-place` | on `wayfind/place.geocode` | Geocodes one place, cache-first, and stores the answer (or "not found") in `places`. Throttled to 1 run a second to stay inside Nominatim's usage policy. |

## The map and geocoding

The Map view shows each package at its newest known location, with a line through the places it has passed. Place text from Ship24 (`MEMPHIS, TN`) is turned into coordinates by the geocoder and cached in the `places` table, so each distinct place is looked up once, ever.

### Trying it locally (no network)

1. Keep `GEOCODER=fake` (the default). The fake knows every place the fake tracking scenarios use.
2. With `npm run dev` and `npm run jobs:dev` running, add `FAKE-TRANSIT-1`, `FAKE-AIR-1`, `FAKE-OFD-1`, `FAKE-DELIVERED-1` and `FAKE-PENDING-1`.
3. In the Inngest UI you will see `geocode-sweep` run, then one `geocode-place` per new place.
4. Open **Map**. `FAKE-PENDING-1` has no checkpoints, so it shows as a pin at its destination.
5. Run `geocode-sweep` again from the UI: it queues nothing, because everything is cached.

The base map tiles come from OpenFreeMap over the internet, so the Map view still needs a connection to draw the background even with the fake geocoder.

### Switching to real geocoding

1. Set `GEOCODER=nominatim`. It uses OpenStreetMap's public instance: no key or account, but it is meant for light use (one request a second, an identifying `User-Agent`, results cached). The `User-Agent` is built from `APP_URL`, so set that to the real origin.
2. Add one package and check the logs and the `places` table: one request for each new place, none for places already cached.
3. Before launch, decide whether to move to a hosted geocoder. That is tracked in `docs/unresolved-issues.md`.

Only place text is sent to the geocoder: city, region, postcode and country for destinations, and each checkpoint's location text. Never names, street addresses or tracking numbers.
