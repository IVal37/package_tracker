# Launch checklist

The first production deploy, in order. Work top to bottom and tick as you go; each section says what to set, where, and how to check it. Nothing here can be done from the code: it is accounts, dashboards and secrets.

Before you start, decide two things:

- **Domain.** Everything below uses `https://<domain>` for the app and `in.<domain>` for forwarded email. Buy it first.
- **Separate production Supabase project?** Recommended: a new project for production, so development data and keys never mix. The steps assume a fresh project.

Keep a private note of every secret as you create it. Never paste one into an issue, a chat or the repo.

## 0. Push the code and see CI pass

The final-sweep commits are on your local `main` only.

1. `git push origin main`.
2. On GitHub, Actions: both jobs (`check` and `e2e`) pass on that commit. Deploy only a commit that is green.

## 1. Supabase (database and sign-in)

1. Create the production project (`docs/supabase-setup.md`, step 1). Region close to where Vercel will run.
2. Apply the migrations from your machine, pointing at production once:
   ```
   DATABASE_URL_DIRECT=<direct/session string, port 5432> npm run db:migrate
   ```
   Check: Table editor shows 10 tables, each with RLS enabled and no policies.
3. **Authentication → URL Configuration**: Site URL `https://<domain>`; Redirect URLs: `https://<domain>/auth/callback` only.
4. **Authentication → Emails → SMTP**: switch to custom SMTP before anyone signs up. Supabase's built-in mailer sends only a handful of emails an hour (launch audit M13). Use Resend's SMTP (`smtp.resend.com`, port 465, user `resend`, password a Resend API key) with a sender on your verified domain (step 6 below; do that first if needed).
5. **Authentication → Providers → Google**: the production OAuth client (Google Cloud Console) with Supabase's callback URL as an authorized redirect URI.
6. **Project Settings → API**: copy the Project URL, the publishable key and the **secret key**. The secret key is used by exactly one module (`src/lib/auth/admin.ts`, account deletion). It goes into Vercel only, never anywhere else.
7. Backups: on the Pro plan, daily backups are on by default; point-in-time recovery is an add-on. Know which you have before launch (it is your rollback for data).

## 2. Accounts for the other services

Create these now so their keys are ready for step 3.

| Service | What to do | Gives you |
| --- | --- | --- |
| Ship24 | Pick the paid plan that covers your expected trackers a month. Create an API key. | `SHIP24_API_KEY`, the plan's monthly tracker count for `SHIP24_MONTHLY_ALLOWANCE` |
| Inngest | Create an account and an app (or install the Vercel integration in step 4, which sets the keys) | `INNGEST_SIGNING_KEY`, `INNGEST_EVENT_KEY` |
| Resend | Add and verify `<domain>` (DNS records), create an API key | `RESEND_API_KEY`, `EMAIL_FROM` such as `Wayfind <alerts@<domain>>` |
| Anthropic | Create an API key with a monthly spend limit | `ANTHROPIC_API_KEY` |
| Sentry | Create a Next.js project; set its data scrubbing to default or stricter | `SENTRY_DSN` |
| Web Push | `npx web-push generate-vapid-keys` once. Keep them for good: changing them silences every device. | `VAPID_PUBLIC_KEY`, `VAPID_PRIVATE_KEY`; `VAPID_SUBJECT` = `mailto:<support address>` |

Before switching the email reader on, run `npm run eval:email` with a few of your own redacted emails in `tests/fixtures/email/real/` and check it reads them correctly (it costs a few cents).

## 3. Vercel project and environment

1. Import the GitHub repo into Vercel. Framework: Next.js. Node 24.
2. Set these **Production** environment variables. Anything not listed keeps its default.

| Key | Value |
| --- | --- |
| `DATABASE_URL` | Supabase transaction pooler string (port 6543) |
| `SUPABASE_URL` | Project URL |
| `SUPABASE_PUBLISHABLE_KEY` | publishable key |
| `SUPABASE_SECRET_KEY` | secret key (account deletion only) |
| `APP_URL` | `https://<domain>` |
| `TRACKING_PROVIDER` | `ship24` |
| `SHIP24_API_KEY` | from Ship24 |
| `SHIP24_WEBHOOK_SECRET` | from Ship24's webhook settings (step 5) |
| `SHIP24_MONTHLY_ALLOWANCE` | trackers a month on your plan |
| `FAKE_WEBHOOK_SECRET` | any long random string (required in production even though the fake provider is off) |
| `INNGEST_SIGNING_KEY`, `INNGEST_EVENT_KEY` | from Inngest (or set by its Vercel integration) |
| `INNGEST_DEV` | **not set** (production refuses it: it would turn off request signing) |
| `GEOCODER` | `nominatim` |
| `INBOUND_EMAIL_DOMAIN` | `in.<domain>` |
| `INBOUND_WEBHOOK_SECRET` | a long random string, shared with the Worker (step 7) |
| `EMAIL_EXTRACTOR` | `claude` (or `fake` to start with forwarding off) |
| `ANTHROPIC_API_KEY` | from Anthropic |
| `PUSH_SENDER` | `webpush` |
| `VAPID_PUBLIC_KEY`, `VAPID_PRIVATE_KEY`, `VAPID_SUBJECT` | from step 2 |
| `EMAIL_SENDER` | `resend` |
| `RESEND_API_KEY`, `EMAIL_FROM` | from Resend |
| `SENTRY_DSN` | from Sentry |
| `ADMIN_EMAILS` | your own email (comma-separated if more) |
| `SUPPORT_EMAIL` | the address shown on the privacy policy and terms |
| `ACTIVE_PACKAGE_CAP`, `EXPIRE_AFTER_DAYS`, `INBOUND_DAILY_LIMIT` | leave unset for 25, 60 and 50 |

3. **Domains**: add `<domain>`; Vercel serves it over HTTPS.
4. **Firewall**: add a rate-limit rule for `/api/webhooks/*` (for example 300 requests a minute per IP, then deny). The app checks each webhook's secret but a flood of bad requests should stop at the edge.
5. Deploy. If a required key is missing, the first request fails with an error that names the key (never its value) in the function logs.

Check: `https://<domain>/sign-in` loads; `https://<domain>/privacy` loads signed out.

## 4. Inngest

1. Install the Inngest Vercel integration (sets both keys) or paste them yourself, then redeploy.
2. In the Inngest dashboard, sync the app at `https://<domain>/api/inngest`.
3. Check: 16 functions appear: the 13 jobs below plus the 3 failure handlers (`geocode-place`, `process-inbound-email` and `send-notification` each get a `-failure` companion).

| Job | When |
| --- | --- |
| `refetch-stale-shipments` | hourly at :00 (queues one `refetch-tracker` per stale tracker) |
| `refetch-tracker` | per event, 5 at a time, 2 a second |
| `expire-quiet-shipments` | daily 03:20 UTC |
| `archive-delivered-shipments` | daily 03:30 UTC |
| `geocode-sweep` | on request and hourly at :15 |
| `geocode-place` | per event, 1 a second |
| `process-inbound-email` | per event |
| `inbound-email-sweep` | hourly at :20 |
| `inbound-email-cleanup` | daily 03:40 UTC |
| `send-notification` | per event, one live run per alert |
| `notifications-sweep` | hourly at :25 |
| `notifications-cleanup` | daily 03:50 UTC |
| `rate-limits-cleanup` | daily 04:00 UTC |

4. Check your plan allows `step.sleepUntil` for up to about 23 hours (alerts held through quiet hours).
5. After an hour, check that the hourly crons ran (Runs tab).

## 5. Ship24

1. Webhook URL: `https://<domain>/api/webhooks/tracking`. Copy the webhook secret into `SHIP24_WEBHOOK_SECRET` and redeploy.
2. Send the dashboard's test message. Expected: 200 (a tracker nobody follows is a 200 on purpose).

## 6. Resend

1. Domain verified (step 2). `EMAIL_FROM` uses an address on it.
2. The same domain serves Supabase's SMTP (step 1.4).

## 7. Cloudflare email forwarding

Follow `docs/email-forwarding-setup.md`, "Real forwarding": Email Routing on `in.<domain>` with a catch-all to the Worker, `wrangler deploy` (allow the `esbuild` and `workerd` install scripts first), and the Worker's `INBOUND_WEBHOOK_SECRET` and endpoint `https://<domain>/api/webhooks/inbound-email`. Use the host the app answers on directly: if the bare domain redirects to `www`, set the Worker's `APP_URL` to the `www` one, because a redirect drops the secret. `curl -i -X POST https://<host>/api/webhooks/inbound-email` must answer `401`, not a `3xx`.

## 8. Production checks

Do every one; fix and redeploy until they pass. Then tag.

- [ ] **Sign-in**: a real magic link arrives (custom SMTP) and signs you in; Google sign-in works; signing out returns to sign-in.
- [ ] **Security headers**: `curl -sI https://<domain>/` shows `strict-transport-security`, `content-security-policy`, `x-frame-options: DENY`, `x-content-type-options: nosniff`, `referrer-policy`, `permissions-policy`.
- [ ] **Map**: the Map view draws the base map and your package's icon, and the browser console shows no "Refused to" (CSP) errors and no "Worker failed to load". `https://<domain>/maplibre-gl-worker.mjs` is served as JavaScript.
- [ ] **Real package**: add a real tracking number; it shows its status and events. `/admin` shows one tracker this month.
- [ ] **Ship24 webhook**: when the carrier next scans that package, Vercel's function logs show `tracking webhook` with status 200 and the package's status changes without waiting for the hourly re-fetch.
- [ ] **Forwarding**: in Setup, copy your address; set up Gmail forwarding (the confirmation code appears in Setup); forward a real shipping email; the package appears. An email that cannot be read shows in Settings with Try again.
- [ ] **Push**: turn on push on a desktop browser, Send a test; then on an iPhone with Wayfind added to the Home Screen.
- [ ] **Alert email**: an alert email arrives from `EMAIL_FROM`; its headers include `List-Unsubscribe: <https://<domain>/settings>`.
- [ ] **Sentry**: in Inngest, invoke `send-notification` with data `{}`. A "wayfind: job_out_of_retries" warning appears in Sentry with only `job` and `error`: no email, tracking number or request data.
- [ ] **Admin**: `/admin` works for you and is a 404 signed out and for another account.
- [ ] **Export and delete**: with a second test account, Download my data (a JSON file with that account's data only), then Delete my account: you land on "Your account is deleted", the user is gone from Supabase Authentication, and its rows are gone from every table.
- [ ] **Deleted account on another device**: before deleting that test account, also sign it in on a second browser. After the delete, open Settings there: it lands on "Your account is deleted" and is signed out, and the `users` table still has no row for that account.
- [ ] **Legal**: `/privacy` and `/terms` load signed out, show `SUPPORT_EMAIL`, and you have reviewed the wording (it is a draft, not legal advice).
- [ ] **Unit and launch tests** are green in CI on the commit you deployed.

Then tag the deployed commit and push the tags:

```
git tag phase-7-done
git tag mvp-launch
git push origin phase-7-done mvp-launch
```

Set CLAUDE.md's current phase to "launched" and tick M13 and M14 in `docs/launch-audit.md`.

## Rolling back

- **A bad deploy**: Vercel → Deployments → the previous one → Promote to Production (instant). Migrations so far only add things and drop one unique constraint, so an older build runs on the newer schema.
- **A bad migration**: restore from Supabase backups (step 1.7). Test migrations against a copy first next time.
- **Turn a feature off without a deploy of code** (change the env var and redeploy, about a minute):
  - Claude spend: `EMAIL_EXTRACTOR=fake` (forwarded emails are stored and fail to read; Try again later).
  - Alerts: `PUSH_SENDER=fake` and/or `EMAIL_SENDER=fake` (alerts are recorded, not sent).
  - Inbound email: disable the catch-all route in Cloudflare Email Routing.
  - Ship24 webhooks: turn off the webhook in the Ship24 dashboard (the hourly re-fetch keeps packages moving).
  - Any background job: pause it in the Inngest dashboard.
- **A leaked secret**: rotate it at the service, update Vercel, redeploy. The VAPID keys are the exception: rotating them breaks every device's push until it is turned on again.

## Running the launch test yourself

`npm run e2e` needs a throwaway Postgres in `E2E_DATABASE_URL` (it is emptied on every run; never the Supabase project), for example a local Docker container:

```
docker run --rm -d -p 5433:5432 -e POSTGRES_PASSWORD=postgres -e POSTGRES_DB=wayfind_e2e postgres:17
E2E_DATABASE_URL=postgres://postgres:postgres@localhost:5433/wayfind_e2e npm run e2e
```

It builds the app, starts it with the fake providers and a fake auth server (`e2e/fake-auth/server.mjs`), signs up, adds a package and checks the list and the map. CI runs it on every push.
