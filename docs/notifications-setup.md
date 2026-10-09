# Notifications and installing the app: setup

Phase 6 sends alerts (out for delivery, delivered or ready for pickup, a problem, a delay) by web push and by email, and lets Wayfind be installed to the home screen. Local development needs no keys: the fake senders record what they would send. These steps are for the real services.

How it fits together:

```
tracking webhook / re-fetch  -> applyTrackerUpdate records an alert row (same transaction)
                             -> an Inngest event per alert
hourly sweep                 -> records "overdue" delay alerts, re-queues lost ones
send-notification job        -> reads the user's settings, waits out quiet hours,
                                sends push (every device) and email, records the outcome
```

Alerts are sent from background jobs only. Nothing in a page or an action sends one, apart from the "Send a test" button on Settings.

## What a user gets

| Alert                         | Fires when                                                                              | Push by default | Email by default |
| ----------------------------- | --------------------------------------------------------------------------------------- | --------------- | ---------------- |
| Out for delivery              | The status becomes out for delivery                                                     | on              | off              |
| Delivered or ready for pickup | The status becomes delivered or available for pickup                                    | on              | on               |
| Problems                      | The status becomes an exception or a failed delivery attempt                            | on              | on               |
| Delays                        | The estimate moves to a later day, or it is more than a day overdue (for up to 14 days) | on              | off              |

Push also needs the user to turn it on for each device (Settings → Push on this device). Quiet hours (off by default) hold both push and email until they end; an alert that has been overtaken by a newer one for the same package, or is more than a day old, is dropped instead of sent.

## Try it locally (no keys, no domain)

This uses the fake senders and the fake tracking provider.

1. `.env.local` needs `INNGEST_DEV=1` (see `docs/webhooks-and-jobs-setup.md`). The sender settings default to `fake`.
2. Run `npm run dev` and, in another terminal, `npm run jobs:dev`.
3. Sign in and add the package `FAKE-TRANSIT-1`.
4. Send the out-for-delivery webhook (this fixture does not move the ETA, so it gives exactly one alert):

```powershell
curl.exe -X POST http://localhost:3000/api/webhooks/tracking `
  -H "Authorization: Bearer fake-secret" `
  -H "Content-Type: application/json" `
  --data-binary "@tests/fixtures/fake/webhook-notify-ofd.json"
```

Expected: HTTP 200, and a `send-notification` run in the Inngest UI (http://localhost:8288). Out for delivery goes by push only by default, and no device is registered yet, so the run ends as `skipped` with the reason `no_destination`. That is correct: nothing was sent because there was nowhere to send it. (Register a device under "Real push" below to see the push.)

5. Send the delivered webhook. Delivered is emailed by default, so the dev terminal prints `fake email sent` with the subject `Delivered: Your package`:

```powershell
curl.exe -X POST http://localhost:3000/api/webhooks/tracking `
  -H "Authorization: Bearer fake-secret" `
  -H "Content-Type: application/json" `
  --data-binary "@tests/fixtures/fake/webhook-notify-delivered.json"
```

6. Send either webhook again: still 200, and no new run. Each event alerts once.
7. `tests/fixtures/fake/webhook-ofd.json` (from the tracking walkthrough) also moves the ETA to 2099, so on a package that has an ETA it gives two alerts: out for delivery and a delay.
8. Quiet hours: on Settings turn them on with a window that covers now and save. Send a new status change (add another `FAKE-TRANSIT-` package and use the fixtures again): the Inngest run shows `quiet-hours-1` sleeping until the window ends, and nothing is sent. Turn quiet hours off and the run, once it wakes, decides again.

Real push on your own machine is in the next section.

## Real push

### 1. VAPID keys

VAPID keys identify your server to the browsers' push services.

```
npx web-push generate-vapid-keys
```

Set, in `.env.local` and then in Vercel:

| Key                 | Value                                                                                |
| ------------------- | ------------------------------------------------------------------------------------ |
| `PUSH_SENDER`       | `webpush`                                                                            |
| `VAPID_PUBLIC_KEY`  | the public key (it goes to the browser, so it is safe to share)                      |
| `VAPID_PRIVATE_KEY` | the private key (server only; never commit it or send it to the browser)            |
| `VAPID_SUBJECT`     | `mailto:you@example.com` or an `https:` page that says who runs the app              |

Keep the same keys for as long as users have the app: changing them invalidates every device's subscription (devices would have to turn push off and on again).

### 2. Try it on your computer

Browsers only allow push on HTTPS (localhost is an exception in Chrome, but not everywhere):

```
npm run dev -- --experimental-https
```

Open the `https://localhost:3000` address it prints, accept the self-signed certificate, and set `APP_URL=https://localhost:3000` in `.env.local` so links in alerts point there. Then:

1. Open Settings → **Turn on push** and allow notifications.
2. Press **Send a test**. A notification appears.
3. Repeat the webhook steps above. Delivered is now a real push (and, with the fake email sender, a printed email).
4. Open the Settings page on a second browser profile, sign in as the same user and turn push on there: both devices get each alert.

If nothing appears: check the browser allowed notifications for the site, that the VAPID keys are set (Settings shows "Push notifications are not set up on this server" without the public key), and the dev terminal for `send-notification` errors. A device that the push service reports gone is deleted automatically.

### 3. iPhone and iPad

Push works on iOS 16.4 and later, and **only for an app installed to the Home Screen**. It needs the deployed HTTPS app (iOS cannot use `localhost`).

1. Open the deployed site in Safari.
2. Tap Share → **Add to Home Screen**.
3. Open Wayfind from the Home Screen icon (not from Safari).
4. Settings → **Turn on push** → allow.

Until it is installed, Settings shows the same steps instead of the button.

## Real email (Resend)

1. Create an account at https://resend.com and add the domain you will send from. Resend gives you DNS records (SPF and DKIM); add them at your DNS host and wait until the domain shows as verified. **Until a domain is verified Resend only delivers to your own account's address**, so real users cannot receive alerts.
2. Create an API key (sending access is enough).
3. Set, locally and in Vercel:

| Key              | Value                                                                       |
| ---------------- | --------------------------------------------------------------------------- |
| `EMAIL_SENDER`   | `resend`                                                                    |
| `RESEND_API_KEY` | the key (server only)                                                       |
| `EMAIL_FROM`     | `Wayfind <alerts@your-verified-domain>`                                     |

Check Resend's current free-plan limits (a daily and a monthly cap) against how many alerts you expect. Each alert uses its own id as an idempotency key, so a retry never sends the same email twice.

## Installing the app (Chrome, Edge, Android)

The manifest and icons are served without sign-in on purpose (browsers fetch them without cookies). Once the site is on HTTPS:

- Chrome or Edge on a computer: the install icon appears in the address bar, and Settings → **Install app** offers the same.
- Chrome on Android: Settings → **Install app**, or the browser menu → Install app.

Installed, Wayfind opens in its own window. The package list is saved as you use it and shown when you are offline, with a note saying when it was saved.

**Shared devices.** The saved list is personal. Signing out removes it and stops alerts to that device. If a session simply expires, the saved list stays until the sign-in page is next opened (it clears it then).

## Checking the service worker

Chrome → DevTools → Application → Service Workers shows `/sw.js`. Offline check: load the list, tick **Offline**, reload: the list appears with "You're offline". Sign out and look under Application → Cache Storage: the `wayfind-*` caches are gone. After changing `public/sw.js`, raise `VERSION` at the top so old caches are removed.

## Troubleshooting

- **No alert arrives.** Open the `send-notification` run in Inngest. The result says what happened: `skipped` with a reason (`channels_off`, `no_destination`, `superseded`, `stale`), a quiet-hours sleep, or an error from a sender. `no_destination` means push is the only channel on for that alert and the user has no device registered.
- **An alert came late.** Quiet hours hold it until they end; the hourly sweep (at :25) re-queues alerts whose first event was lost.
- **Delay alerts.** An "overdue" alert only comes from the hourly scan, so it can be up to an hour after the 24-hour mark.
- **A device stopped getting alerts.** The push service reported it gone (browser data cleared, app uninstalled) and it was removed. Turn push on again there.
- **Email never arrives.** Resend rejects unverified domains and addresses it has suppressed. A refusal of that kind is permanent: the alert is marked `failed` and not retried. Temporary errors (rate limit, outage) retry up to four times.
