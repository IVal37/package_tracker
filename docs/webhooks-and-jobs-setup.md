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
2. Easiest: install the Inngest integration for your Vercel project; it sets `INNGEST_SIGNING_KEY` for you. Otherwise copy the signing key from the Inngest dashboard into the Vercel environment variable `INNGEST_SIGNING_KEY`.
3. Deploy, then in the Inngest dashboard sync the app at `<APP_URL>/api/inngest`. Both functions should appear with their cron schedules.
4. `INNGEST_SIGNING_KEY` is required in production. If it is missing, `/api/inngest` returns an error that names the missing key.

Free tier: 50,000 step runs a month. These two jobs use about 750.

## What the jobs do

| Job | Schedule | Effect |
| --- | --- | --- |
| `refetch-stale-shipments` | hourly | Fetches up to 100 trackers whose shipments had no provider update for 24 hours, oldest first, and applies what comes back. Stops on rate limiting, an outage, a bad API key or an exhausted quota, and tries again next hour. |
| `archive-delivered-shipments` | daily 03:30 UTC | Archives shipments delivered 14 or more days ago. |
