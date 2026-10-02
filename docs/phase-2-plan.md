# Phase 2 — Accounts, manual add, list view: plan

Decisions: Supabase Auth (magic link + Google); Tailwind CSS (2026-10-02).


## Goal

A signed-in user can add packages by tracking number and see them in a list grouped by status. They can open any package in a detail drawer to see its full timeline, and delete it. No user can ever read or change another user's data. The header has an "Upgrade" button that only opens a "Coming soon" dialog.

## Dependencies to approve

| Package | Why |
| --- | --- |
| `@supabase/supabase-js`, `@supabase/ssr` | Supabase Auth with cookie sessions in Next.js (Stack: "Supabase Auth") |
| `tailwindcss`, `@tailwindcss/postcss` (dev) | Styling, chosen by the user. Tailwind v4: `postcss.config.mjs` plus `@import "tailwindcss"` in `globals.css` |

Approving this plan approves these four packages and nothing else.

## Design decisions

- **All Supabase calls happen on the server**, through Server Actions, route handlers and `proxy.ts`. No browser Supabase client is needed. The Supabase URL and publishable key are therefore ordinary server-only env keys (`SUPABASE_URL`, `SUPABASE_PUBLISHABLE_KEY`) in `src/lib/env.ts`, and nothing becomes `NEXT_PUBLIC_*`. Add `APP_URL` (default `http://localhost:3000`) for auth redirect URLs.
- **Session handling follows Supabase's Next.js 16 guide:**
  - `src/proxy.ts` refreshes the session on every request with `supabase.auth.getClaims()` and redirects signed-out users away from protected paths.
  - Pages and actions authorize with `getClaims()`, which verifies the JWT, and never `getSession()`.
  - Magic link and Google both use the PKCE flow and come back to one route, `/auth/callback`, which calls `exchangeCodeForSession`.
- **The `users` row is keyed by the Supabase auth user id.** `/auth/callback` upserts it (`ensureUser`). The schema needs no change because `users.id` is already a uuid. We don't add an FK to `auth.users`, so PGlite tests keep working without Supabase's `auth` schema.
- **Ownership is enforced in the query layer.** Every function in `src/lib/db/shipments.ts` takes `userId` as a required argument and puts `user_id = $userId` in its `WHERE`. No unscoped shipments query exists. When a shipment belongs to someone else, lookups return "not found", exactly as if it didn't exist, so existence never leaks. The app connects to Postgres as the owner role, which bypasses RLS, so these checks are the real guard.
- **RLS is a backstop for Supabase's Data API.** Supabase exposes the `public` schema to the `anon` and `authenticated` roles through PostgREST. Enabling RLS on all 5 tables with **no policies** denies that path entirely. Do it with Drizzle's `.enableRLS()` on each table, so the generated migration carries it.
- **The provider records its own name.** Add `readonly name: "ship24" | "fake"` to `TrackingProvider`, so `shipments.provider` stores which provider created each row.
- **The detail drawer is URL-driven.** `/?shipment=<id>` makes the server page fetch that shipment's detail, scoped by user, and render the drawer. There's no client-side data fetching, the drawer is deep-linkable, and closing it navigates to `/`.
- **Dialogs** (the drawer and Upgrade) are React-state-controlled `role="dialog" aria-modal` elements. They close on Escape and backdrop click, and focus returns to the trigger. Native `<dialog>` isn't used because jsdom's support for it is unreliable for tests.
- **List rules** live in pure functions:
  - Display order: OutForDelivery, AttemptFail, Exception, AvailableForPickup, InTransit, InfoReceived, Pending, Delivered, Expired. Empty groups are hidden.
  - Within a group: ETA ascending with no-ETA last, then `last_event_at` descending, then `created_at` descending.
  - Archived shipments are excluded.

## Steps (one commit each)

### 1. Tailwind
- Install the Tailwind packages and add `postcss.config.mjs`.
- `src/app/globals.css` gets `@import "tailwindcss"` and a small `@theme` with brand colours.
- Restyle `Wordmark` with Tailwind classes; its test keeps passing.

Commit: `chore: add Tailwind CSS`

### 2. Schema: RLS + provider name (own commit, before feature code)
- In `src/lib/db/schema.ts`, add `.enableRLS()` to the 5 tables, then `npm run db:generate` produces `drizzle/0001_*.sql`.
- Extend `src/lib/db/schema.test.ts`: `pg_class.relrowsecurity` is true for every public table.
- Add `name` to `TrackingProvider` in `src/lib/tracking/types.ts` and implement it in `Ship24Provider` and `FakeProvider`. Add a contract assertion in `src/lib/tracking/contract.ts`.

Commit: `feat(db): enable RLS on all tables; add provider name`

### 3. Env + Supabase server client
- In `src/lib/env.ts`, add `SUPABASE_URL` (url, required), `SUPABASE_PUBLISHABLE_KEY` (required) and `APP_URL` (url, default `http://localhost:3000`). Update `.env.example` and the env tests (the `valid` fixture gains the new keys).
- `src/lib/auth/supabase-server.ts`: `createSupabaseServerClient()` wraps `createServerClient` with `cookies()` from `next/headers`, using `getAll`/`setAll`. `setAll` is wrapped in try/catch because it can't run while a Server Component is rendering, and the proxy handles the refresh.
- `src/lib/auth/session.ts`:
  - `getCurrentUser()` calls `getClaims()` and returns `{ id, email } | null`.
  - `requireUser()` calls `redirect("/sign-in")` when there's no user.
- `src/lib/auth/paths.ts`: a pure `isPublicPath(pathname)` (`/sign-in`, `/auth/*` and static assets).
- `src/proxy.ts`: build the Supabase client on the request/response cookies, call `getClaims()`, redirect to `/sign-in` when there are no claims and the path isn't public, and return the response carrying the refreshed cookies. Use the matcher from Supabase's guide.
- Tests:
  - `isPublicPath` table.
  - `getCurrentUser` / `requireUser`, with the Supabase factory mocked.

Commit: `feat(auth): Supabase server client, session helpers and proxy`

### 4. Sign-in, callback, sign-out
- `src/lib/db/users.ts`: `ensureUser(db, { id, email })` inserts, and on conflict on `id` updates the email. PGlite test.
- `src/app/sign-in/page.tsx` + `actions.ts`:
  - `signInWithEmail` validates the email with zod, then `signInWithOtp({ email, options: { emailRedirectTo: APP_URL + "/auth/callback" } })`, then shows "Check your email".
  - `signInWithGoogle` calls `signInWithOAuth({ provider: "google", options: { redirectTo } })`, then `redirect(data.url)`.
  - Error states come from `?error=`.
- `src/app/auth/callback/route.ts`:
  - Reads `code`, calls `exchangeCodeForSession`, then `ensureUser` from the verified claims, then redirects to `/`.
  - Any failure redirects to `/sign-in?error=auth`.
  - There's no `next` param, which avoids an open redirect.
- Sign out: `signOut` action, then redirect to `/sign-in`.
- Logic sits in small lib functions under `src/lib/auth/`, so it can be tested with the Supabase client mocked. Tests:
  - Email validation.
  - The OTP call's `emailRedirectTo`.
  - Callback: missing code, an exchange error, and success (calls `ensureUser`, then redirects).

Commit: `feat(auth): magic link and Google sign-in`

### 5. Ownership-scoped queries — `src/lib/db/shipments.ts`
Every function takes `userId` as a required argument:
- `listShipments(db, userId)`: non-archived shipments plus each one's latest checkpoint (message, location, occurred_at), in one query using a lateral join or `DISTINCT ON`.
- `getShipmentDetail(db, userId, shipmentId)`: the shipment plus all checkpoints, newest first, or `null`.
- `findShipmentByTrackingNumber(db, userId, trackingNumber)`.
- `createShipmentWithCheckpoints(db, userId, data, events)`: one transaction; it reuses `insertCheckpoints` from `src/lib/db/checkpoints.ts`.
- `deleteShipment(db, userId, shipmentId)`: returns whether a row was deleted.

PGlite tests with two users, A and B:
- B's list never contains A's rows.
- `getShipmentDetail(B, A's id)` returns `null`.
- `deleteShipment(B, A's id)` returns false, and A's row still exists.
- A malformed uuid returns null or false instead of throwing.

Commit: `feat(db): ownership-scoped shipment queries`

### 6. Add / delete business logic — `src/lib/shipments/`
- **`validation.ts`:** `addShipmentSchema`.
  - `trackingNumber` goes through `normalizeTrackingNumber` (from `@/lib/tracking`), must be 5–50 characters and match `^[A-Z0-9\-_/.]+$` (Ship24's rule).
  - `nickname` is trimmed, optional and at most 60 characters; an empty string becomes null.
- **`add-shipment.ts`:** `addShipment({ db, provider, userId, input })`.
  1. Validate.
  2. If a duplicate exists for this user, return `{ ok: false, error: "duplicate" }`.
  3. Otherwise call `provider.createTracking`.
  4. Then `createShipmentWithCheckpoints`.

  Result type: `{ ok: true, shipmentId } | { ok: false, error: "invalid" | "duplicate" | "not_found" | "unavailable", fieldErrors? }`. Mapping:
  - `InvalidTrackingNumberError` → `not_found`
  - quota, rate-limit and unavailable errors → `unavailable`
  - a unique violation from a race → `duplicate`

  The provider is never called for invalid input or duplicates, which saves Ship24 quota.
- **`delete-shipment.ts`:** `removeShipment({ db, provider, userId, shipmentId })`.
  1. Load it, scoped to the user; if it's missing, return `not_found` (also for other users' shipments).
  2. Call `provider.deleteTracking`. `TrackerNotFoundError` is ignored; other errors are logged and the delete still goes ahead, so users can always delete.
  3. Delete the row.
- Tests on PGlite with the fake provider, created through `createTrackingProvider` from `@/lib/tracking` so the lint guard stays satisfied:
  - Spaces are stripped and case normalized.
  - Invalid formats are rejected, and the provider isn't called (spy).
  - A duplicate for the same user is rejected, and the provider isn't called.
  - The same number for a different user is allowed.
  - Optional nickname.
  - Checkpoints are stored.
  - Each provider error maps to its result.
  - A user can't delete another user's shipment.

Commit: `feat(shipments): add and delete with validation and duplicate rejection`

### 7. Grouping, sorting, formatting — `src/lib/shipments/grouping.ts`, `format.ts`
- `STATUS_DISPLAY_ORDER`, `groupShipmentsByStatus(shipments)` (returns ordered, non-empty groups), `compareShipments`.
- `STATUS_LABELS` (e.g. `AttemptFail` → "Delivery attempted", `AvailableForPickup` → "Ready for pickup").
- `formatEta(eta, now)`: "Today", "Tomorrow", a weekday or a date, using `Intl.DateTimeFormat`.
- Table-driven tests: group order, hidden empty groups, ETA sort with nulls last, tie-breaks, labels for all 9 statuses, ETA phrasing around midnight and timezone boundaries with an injected `now`.

Commit: `feat(shipments): grouping, sorting and formatting`

### 8. UI components — `src/components/`
- **`status-chip.tsx`:** label and colour per status, with `data-status` set for tests.
- **`shipment-list.tsx`:** a server component with a section per group (heading + count). Each row shows the nickname (or the tracking number), the status chip, the ETA and the last checkpoint (message, location, relative time). Each row links to `?shipment=<id>`. Empty state: "No packages yet — add a tracking number above."
- **`add-package-form.tsx`:** a client component using `useActionState`, with a tracking-number field and an optional nickname. It shows field errors and the duplicate, not-found and unavailable messages, and disables the submit button while the action is pending.
- **`shipment-drawer.tsx`** (client, the dialog) and **`timeline.tsx`**:
  - The drawer shows the header (name, number, courier, chip, ETA), the timeline (each checkpoint's status, message, location and time, newest first) and a Delete button that asks for confirmation.
  - Close and Escape navigate to `/`.
- **`upgrade-button.tsx`:** a client component that opens a "Coming soon" dialog with a close button. It makes no network calls.
- **`site-header.tsx`:** `Wordmark`, `UpgradeButton`, the user's email and Sign out.
- Tests (Testing Library):
  - **StatusChip:** every one of the 9 statuses renders its label.
  - **ShipmentList:** groups render in order with their counts, the last checkpoint shows, and the empty state appears.
  - **AddPackageForm:** renders each error state from a mocked action result.
  - **Drawer:** the timeline order, Escape calls close, and Delete asks for confirmation.
  - **UpgradeButton:** opens and closes the dialog, while a `vi.spyOn(globalThis, "fetch")` spy shows zero calls (and MSW's `onUnhandledRequest: "error"` would also catch any call).

Commit: `feat(ui): list, add form, drawer, status chips, upgrade dialog`

### 9. Wire up the page — `src/app/page.tsx`, `src/app/actions.ts`
- **`page.tsx`:**
  1. Get the user with `requireUser()`.
  2. Load `listShipments(getDb(), user.id)` and group the result.
  3. Render `SiteHeader`, `AddPackageForm` and `ShipmentList`.
  4. If `searchParams.shipment` is set, load `getShipmentDetail(getDb(), user.id, id)`. A missing or foreign id simply renders no drawer.
- **`actions.ts`:** `addPackageAction` and `deletePackageAction`. Each parses `FormData`, runs `requireUser()`, calls the lib function with `getDb()` and `getTrackingProvider()`, then runs `revalidatePath("/")`. They hold no business logic.
- Update `src/app/layout.tsx` with metadata and the Tailwind body classes.
- Thin tests for the actions with lib functions and auth mocked: an unauthenticated call redirects, and the authenticated `userId` is passed through and is **never read from form data**.

Commit: `feat(app): signed-in list page with add, detail and delete`

### 10. CI build step + docs
- Add `npm run build` to `.github/workflows/ci.yml`, with dummy env values, to catch server/client boundary mistakes.
- Update CLAUDE.md:
  - the auth decision (Supabase Auth)
  - the folder layout: `lib/auth/`, `lib/shipments/`, `src/proxy.ts`
  - the "every shipments query takes userId" rule
  - the env keys
- Add a `docs/supabase-setup.md` checklist for the user:
  1. Create the project.
  2. Set Auth URL configuration: Site URL and the redirect URL `http://localhost:3000/auth/callback` (plus the production URL later).
  3. Enable Email magic link.
  4. Create a Google OAuth client and enable the Google provider.
  5. Copy the URL, publishable key and DB URLs into `.env.local`.
  6. Run `npm run db:migrate`.

Commit: `docs: Phase 2 auth setup and conventions`

## Explicitly not in Phase 2

- Webhooks, re-poll and archive jobs (Phase 3)
- The map (Phase 4)
- Email forwarding and the forwarding alias (Phase 5)
- Notifications and the PWA (Phase 6)
- Per-user package cap and rate limiting (Phase 7)
- Payments: Upgrade only shows "Coming soon"
- Playwright

## Test gate (coverage target 85%)

- **Ownership:** no user can read or delete another user's shipment. This is checked in the query layer (PGlite, two users), in the business logic and in the actions (where userId comes only from the session).
- **Validation and duplicates:** validation, normalization and duplicate rejection are covered, and the provider isn't called for invalid input or duplicates.
- **List rules:** the grouping and sorting functions are covered.
- **Status chips:** each of the 9 statuses renders the right chip.
- **Upgrade:** the button opens the dialog and makes no network calls.
- **Checks:** `npm run lint`, `typecheck`, `test:coverage` and `build` pass locally and in CI, with coverage at least 85% on files touched in Phase 2. Report the numbers.
- **Finish:** push (ask first), confirm CI through the GitHub API, tag `phase-2-done`, and set CLAUDE.md "Current phase" to Phase 3.

## Verification (build session)

1. `npm test`: all green, including the PGlite ownership suites.
2. **Manual, once the user has completed `docs/supabase-setup.md`:**
   1. `npm run dev` with `TRACKING_PROVIDER=fake`.
   2. Sign in with a magic link, then with Google.
   3. Add `FAKE-OFD-1`, `FAKE-DELIVERED-1` and `FAKE-EXCEPTION-1`, and check the grouping and order.
   4. Add `FAKE-OFD-1` again and see the duplicate error.
   5. Open the drawer and check the timeline.
   6. Delete a package.
   7. Click Upgrade and see "Coming soon", with no requests in the Network tab.
   8. Sign out, and confirm `/` redirects to `/sign-in`.
3. **Manual ownership check:** sign in as a second account and confirm that pasting the first account's `/?shipment=<id>` shows no drawer.
