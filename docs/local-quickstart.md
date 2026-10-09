# Local quickstart: before you open localhost

Run these from the project folder, in order. Steps 1 to 3 are one-time (and again after pulling new migrations); step 4 is every time.

## 1. Install packages

```
npm install
```

(The worker project has its own packages, only needed if you work on `workers/inbound-email/`: `cd workers/inbound-email; npm install`.)

## 2. Check `.env.local`

It must exist in the project folder (copy `.env.example` if not) and contain at least:

```
DATABASE_URL=...            # Supabase transaction pooler, port 6543
DATABASE_URL_DIRECT=...     # Supabase direct or session string, port 5432
SUPABASE_URL=...
SUPABASE_PUBLISHABLE_KEY=...
APP_URL=http://localhost:3000
INNGEST_DEV=1
```

Everything else defaults to the fake services, which never touch the network or cost money: `TRACKING_PROVIDER=fake`, `GEOCODER=fake`, `EMAIL_EXTRACTOR=fake`, `PUSH_SENDER=fake`, `EMAIL_SENDER=fake`. Setup of the Supabase values is in `docs/supabase-setup.md` (including the redirect URL `http://localhost:3000/auth/callback`, which sign-in needs).

## 3. Apply database migrations

```
npm run db:migrate
```

Safe to repeat. Run it again whenever a new file appears in `drizzle/` (Phase 6 added one that creates the notification tables, so run it at least once now).

## 4. Start the two servers (two terminals)

```
npm run dev
```

```
npm run jobs:dev
```

`npm run dev` is the app, at http://localhost:3000. `npm run jobs:dev` is the background-job server (Inngest, UI at http://localhost:8288). Without it the app still works, but adding a package waits about 2 seconds for a job request that gives up, and alerts, email reading and geocoding do not run.

## 5. Quick check before you look around

In a third terminal, optional but fast:

```
npm run typecheck
npm test
```

## Then try it

- Sign in at http://localhost:3000 with a magic link or Google.
- Add the fake package `FAKE-TRANSIT-1` (other fake numbers: `FAKE-OFD-1`, `FAKE-DELIVERED-1`). The map view needs no key.
- Walkthroughs with `curl`: tracking webhooks in `docs/webhooks-and-jobs-setup.md`, forwarded email in `docs/email-forwarding-setup.md`, alerts and the installable app in `docs/notifications-setup.md`.

## If something is off

- **"Invalid environment: missing …"**: a required key is missing from `.env.local`. The message names the key, never its value.
- **Tables or columns missing**: run `npm run db:migrate` (step 3).
- **Blank map**: stop `npm run dev` and start it again (the map's worker file is copied into `public/` at start-up), then check the browser console for "Worker failed to load".
- **Sign-in link goes nowhere**: the redirect URL is not set in Supabase (`docs/supabase-setup.md`, step 4), or `APP_URL` does not match the address you are using.
- **A stale offline copy or odd behaviour after testing the installable app**: in the browser's dev tools open Application, then Service Workers and Cache Storage, unregister the worker and clear the `wayfind-*` caches.
- **A test run dies with a "Worker exited unexpectedly" error**: run `npm test` again; it is an occasional Windows crash and is logged in `docs/unresolved-issues.md`.
