# Supabase setup (one-time, done by you)

Wayfind uses one Supabase project for the Postgres database and for sign-in. Do these steps once; the app can't run against real accounts until you have.

## 1. Create the project

1. Create a project at https://supabase.com/dashboard and note the database password you choose.
2. **Project Settings → API**: copy the **Project URL** and the **publishable key** (`sb_publishable_...`). The **secret key** (`sb_secret_...`, formerly `service_role`) bypasses every rule in Supabase. Wayfind uses it in exactly one place, `src/lib/auth/admin.ts`, to delete a person's sign-in account when they delete their Wayfind account; ESLint lets only `src/lib/privacy` import that module. Set it as `SUPABASE_SECRET_KEY` on the server only (required in production; locally, leave it out and account deletion says it is unavailable). Never put it anywhere else, never in a `NEXT_PUBLIC_*` variable.
3. **Project Settings → Database → Connection string**: copy the **transaction pooler** string (port 6543) and the **session pooler / direct** string (port 5432).

## 2. Put the values in `.env.local`

Copy `.env.example` to `.env.local` (it is git-ignored) and fill in:

```
DATABASE_URL=<transaction pooler string, port 6543>
DATABASE_URL_DIRECT=<direct or session string, port 5432>
SUPABASE_URL=<Project URL>
SUPABASE_PUBLISHABLE_KEY=<publishable key>
APP_URL=http://localhost:3000
TRACKING_PROVIDER=fake
```

Leave `TRACKING_PROVIDER=fake` for development so no Ship24 quota is used.

## 3. Apply the migrations

```
npm run db:migrate
```

This creates the tables (10 as of Phase 7) and enables row-level security on every one, with no policies, so Supabase's Data API can read nothing.

## 4. Configure sign-in

**Authentication → URL Configuration**

- Site URL: `http://localhost:3000`
- Redirect URLs: add `http://localhost:3000/auth/callback`
- For production later, add your real URL and `https://<your-domain>/auth/callback`, and set `APP_URL` to it.

**Authentication → Providers → Email**: enable it (magic link). Supabase's built-in mailer sends only a few emails an hour: fine for development, not for launch. Production uses custom SMTP (Resend), see `docs/launch-checklist.md`. Wayfind also limits sign-in links itself: 5 per 10 minutes per IP and per email address.

**Authentication → Providers → Google**

1. In Google Cloud Console, create an OAuth client (type: Web application).
2. Add Supabase's callback URL (shown on the Google provider page, `https://<project-ref>.supabase.co/auth/v1/callback`) as an authorized redirect URI.
3. Paste the client ID and secret into Supabase and enable the provider.

## 5. Try it

```
npm run dev
```

Sign in at http://localhost:3000, then add `FAKE-OFD-1`, `FAKE-DELIVERED-1` and `FAKE-EXCEPTION-1` to see each status group.
