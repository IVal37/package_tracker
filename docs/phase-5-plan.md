# Phase 5 — Auto-capture by email forwarding: plan

Decisions: inbound email through Cloudflare Email Routing + a small Email Worker; the user has no domain yet, so development and tests use the same webhook with fixtures (2026-10-08). Extraction by Claude Haiku 4.5 (`claude-haiku-4-5`) through the official Anthropic SDK.


## Goal

A user forwards an order or shipping email to a private address (e.g. `izaak-7f3k@in.wayfind.app`) and the package appears in their list, with the retailer and item. An order confirmation, which has no tracking number yet, appears under "Ordered" and becomes a real tracked shipment when the shipping email arrives. Email content is untrusted: the model has no tools and sees one email, its output is schema-validated and grounded in the email text, and nothing it says can touch another user's data.

## Facts that shape this design

Read 2026-10-08.

- **Cloudflare Email Routing is free** (unlimited inbound; Email Workers get 100,000 invocations a day free). An Email Worker's `email(message)` handler receives the **envelope** sender and recipient (`message.from`, `message.to`), the headers, and the raw MIME as a stream (`message.raw`, size in `rawSize`, up to 25 MiB). MIME parsing is done in the Worker with `postal-mime`. Receiving on a domain needs that domain's DNS on Cloudflare.
- **The envelope recipient, not the `To:` header, identifies the user.** Gmail auto-forwarding keeps the original `To:` (the user's own address); only the envelope recipient is our alias.
- **Gmail makes you confirm a forwarding address.** It sends a message from `forwarding-noreply@google.com` ("Gmail Forwarding Confirmation") to the new address, containing an 8-digit confirmation code and a link. Our alias is the only place that message goes, so Wayfind has to catch it and show the code in Settings, or setting up Gmail forwarding is impossible. Outlook forwarding rules need no confirmation.
- **Postmark Inbound** needs its paid plan (about $16.50/month) and wasn't chosen. Nothing here ties the app to Cloudflare: the webhook takes a provider-neutral JSON body, so another receiver would only need its own small adapter.
- **Haiku 4.5** (`claude-haiku-4-5`, $1 / $5 per million tokens) supports structured outputs (`output_config.format`). One email is roughly 3-5k input tokens and 200 output tokens, so about half a cent per email. The `claude-api` guidance for TypeScript projects is to use the official SDK (`@anthropic-ai/sdk`), not raw `fetch`, which also gives typed errors and retries.
- **Shopify-style order numbers collide.** Many stores number orders `#1001`, `#1002`, so an order number is only meaningful together with the retailer.

## Dependencies to approve

| Package | Where | Why |
| --- | --- | --- |
| `@anthropic-ai/sdk` | app | Calls Claude Haiku 4.5 (Stack: "field extraction with Claude Haiku 4.5") |
| `postal-mime` | `workers/inbound-email/` only | Parses the raw MIME in the Cloudflare Worker |
| `wrangler`, `@cloudflare/workers-types` (dev) | `workers/inbound-email/` only | Deploys and types the Worker |

The Worker is a separate mini-project with its own `package.json` and lockfile, so none of its packages reach the Next.js app. Approving this plan approves these four packages and nothing else.

## Design decisions

- **Flow.** Cloudflare receives the mail, the Worker parses it and POSTs a small JSON body to `/api/webhooks/inbound-email` with `Authorization: Bearer <INBOUND_WEBHOOK_SECRET>`. The route authenticates, finds the user by alias, stores the email, sends an Inngest event and returns 200. The Inngest function `process-inbound-email` does the real work. This follows the webhook rules in CLAUDE.md: authenticate first, raw body, idempotent, fast 2xx, heavy work in a job.
- **Webhook body** (our own provider-neutral shape, validated with zod): `recipient` (envelope), `from`, `subject`, `messageId`, `date`, `text`, `html`. The Worker caps `text` and `html` at 200,000 characters each; the route rejects a body over 1 MB with 413.
- **Webhook responses:**

  | Case | Response | Why |
  | --- | --- | --- |
  | Missing or wrong secret | 401 | Unauthenticated |
  | Authenticated, body fails the schema | 422 | A bug on our side or the Worker's; visible in logs |
  | Body over 1 MB | 413 | Refuse oversized input |
  | Recipient isn't a known alias | 200, nothing stored | "Dropped" without telling a prober which aliases exist |
  | Same `messageId` already stored for that user | 200, nothing new | Idempotent (Cloudflare or a forwarder may deliver twice) |
  | User is over the daily cap | 200, nothing stored | Protects the Claude bill from alias spam |
  | Stored | 200 | |
  | Database error | 500 | The Worker is told to retry |

  Logs record outcomes and counts only, never the body, subject, addresses or secret.
- **Aliases.** `users.forwarding_alias` (already in the schema) holds `<slug>-<4 random chars>`: a lower-case slug of the email's local part (max 12 characters) plus 4 characters from an unambiguous alphabet. The full address is `<alias>@<INBOUND_EMAIL_DOMAIN>`. The alias is created the first time the user opens Settings (collisions retry on the unique constraint) and can be regenerated there if it ever leaks; the old one stops working at once.
- **Daily cap.** At most `INBOUND_DAILY_LIMIT` (default 50) stored emails per user per day. Anyone who learns an alias can email it, so this is the cost control until Phase 7's package cap and rate limiting.
- **Storage.** `inbound_emails.raw` holds the normalized body as JSON text (subject, from, text, html); `extracted` holds the validated extraction and the outcome. A new `message_id` column, unique per user, gives idempotency. Raw rows are **deleted after 30 days** by a daily job.
- **Extraction pipeline** (`process-inbound-email`), in order:
  1. **Gmail confirmation:** sender `forwarding-noreply@google.com` with an 8-digit code → store the code in `extracted`, status `ignored`, nothing else. Only the digits are kept, never the link.
  2. **HTML to text:** a small pure function strips scripts and styles, turns block tags into newlines, keeps links as `text (url)`, decodes entities and truncates to 12,000 characters for the model.
  3. **Regex pass:** known carrier formats (UPS `1Z…` with its checksum, USPS 20-22 digits starting 92/93/94/95, FedEx 12/15 digits, DHL 10 digits, Amazon `TBA…`) over the text, the HTML and the links. These are *candidates* with a carrier guess.
  4. **Claude Haiku 4.5**, no tools, no thinking, `temperature: 0`, with the email inside delimiters and a system prompt that says the content is untrusted data. The response is constrained with `output_config.format` (JSON schema from `z.toJSONSchema`) and then **validated again with zod**. Result: `email_type` (`order_confirmation` | `shipping_confirmation` | `delivery_update` | `other`), `retailer`, `item`, `order_number`, and up to 5 `tracking_numbers` with an optional carrier. The model has no field for a user, address or URL.
  5. **Grounding:** a tracking number is accepted only if it passes the same normalization and format rule as the Add form (`normalizeTrackingNumber`, 5-50 characters, `^[A-Z0-9\-_/.]+$`) **and appears in the email text, HTML or links** (ignoring case, spaces and dashes). A number the model invented, or that an attacker told it to output, is discarded.
  6. **Merge:** for `shipping_confirmation` and `delivery_update`, the grounded model numbers plus any strong regex candidates the model missed. For an order confirmation or `other`, regex candidates are ignored (order confirmations are full of look-alike numbers).
  7. **Act**, for the alias's owner only (the user id comes from the alias lookup at webhook time, never from the model or the email).
- **Orders and placeholders.** A new `orders` table: `user_id`, `retailer`, `retailer_key`, `item`, `order_number`, `shipment_id` (null until shipped), `source_email_id`, `created_at`.
  - `retailer_key` is the retailer name lower-cased, with corporate suffixes and `.com` removed, punctuation stripped. Orders match on `(user, retailer_key, order_number)`; if either side has no retailer or no order number, nothing matches.
  - Unique `(user_id, retailer_key, order_number)` where `shipment_id is null` (one placeholder per order) and unique `(shipment_id)` where it's not null (one order row per shipment).
  - **Order confirmation:** create the placeholder; if an order row for the same key already exists (placeholder or shipped), update nothing and skip.
  - **Shipping email:** for each grounded tracking number, create the shipment through the existing `addShipment` (so it goes through `TrackingProvider`, with the same validation, duplicate rejection and error mapping). The nickname defaults to the item, falling back to the retailer. The matching placeholder is attached by setting its `shipment_id`; with no placeholder, a shipped order row is created so the retailer and item are kept. A second tracking number for the same order gets its own order row.
  - A tracking number the provider rejects or the user already has is recorded in `extracted` and skipped; one bad number never blocks the others. A provider outage fails the job so Inngest retries it.
  - **"Ordered" is not a `Status`.** The status enum stays as CLAUDE.md defines it; "Ordered" is a list section for orders without a shipment, shown just before Delivered.
  - Orders without a shipment older than 90 days are deleted by the same daily cleanup job.
- **Safety properties, stated as tests (see Test gate):**
  - Nothing in the email or the model's output selects the user. The user is fixed by the alias before the model runs.
  - The model call has no database, no tools and no network access of its own; it only returns text that is then validated.
  - Strings the model returns (retailer, item) are only ever rendered as React text, never as HTML or URLs.
  - Unknown aliases create no rows.
- **Extractor adapters, like the tracking and geocoding providers.** `Extractor` interface; `ClaudeExtractor` (SDK) and `FakeExtractor` (deterministic, regex-only, no network, the default), chosen with `EMAIL_EXTRACTOR=fake|claude`. ESLint keeps specific extractors from being imported outside `src/lib/email/`. `ANTHROPIC_API_KEY` is required only when `EMAIL_EXTRACTOR=claude`.
- **Env keys:** `INBOUND_EMAIL_DOMAIN` (default `in.localhost` in development, required in production), `INBOUND_WEBHOOK_SECRET` (default dev secret in development, required in production, like `FAKE_WEBHOOK_SECRET`), `INBOUND_DAILY_LIMIT` (default 50), `EMAIL_EXTRACTOR` (default `fake`), `ANTHROPIC_API_KEY`. The build hands you the `.env.example` lines, since Claude can't edit that file.
- **System-scope module.** Finding a user by alias happens for no signed-in user, so, like `tracker-sync`, it lives in its own module, `src/lib/db/inbound-sync.ts`, which ESLint lets only `src/lib/email/**` and `src/jobs/**` import. It returns a user id only. Everything the signed-in user touches (alias, orders, dismissing an order) is a normal user-scoped query.
- **The bearer check moves.** `verifyBearerSecret` currently lives in `src/lib/tracking/`; it moves to `src/lib/auth/bearer.ts` and the tracking code imports it from there, so the email code doesn't reach into the tracking folder.
- **The Cloudflare Worker** (`workers/inbound-email/`) is small on purpose: `handler.ts` is pure and testable (takes the message, a parser and a `fetch`), and `index.ts` wires in `postal-mime` and the real `fetch`. It forwards the **envelope** recipient, caps text and HTML, skips messages over 25 MiB, and does nothing else. Root Vitest includes `workers/**/*.test.ts`; root `tsc` and ESLint cover `handler.ts` and its tests but not `index.ts` (which needs the Worker-only packages).
- **Settings page** (`/settings`, signed-in, dynamic): the private address with a copy button; steps for a Gmail filter (forward matching order and shipping mail) and an Outlook rule; the latest Gmail confirmation code when one arrived in the last 3 days; a "Regenerate address" button; and a count of emails that couldn't be read. A "Settings" link goes in the header.

## Steps (one commit each)

### 1. Schema (own commit, before feature code)
- Load the `supabase-postgres-best-practices` skill.
- `orders` table with RLS enabled and the two partial unique indexes; `inbound_emails`: `message_id`, `from_address`, `subject`, unique `(user_id, message_id)` where `message_id` is not null, and an index for the pending sweep. `users.forwarding_alias` stays; add a check that it is lower-case.
- `npm run db:generate`, read the SQL, extend `schema.test.ts`: both partial uniques (a second placeholder for the same key is rejected, a second order for the same shipment is rejected, two placeholders with different keys are fine), the message-id uniqueness, RLS on `orders`.

Commit: `feat(db): orders and inbound email columns`

### 2. Env and shared bearer check
- Move `verifyBearerSecret` to `src/lib/auth/bearer.ts`; update the tracking imports and keep their tests green.
- `src/lib/env.ts`: the keys above, with the production-required rules and the "`ANTHROPIC_API_KEY` required when `EMAIL_EXTRACTOR=claude`" rule. Tests for each rule.

Commit: `feat(env): inbound email and extractor settings`

### 3. Aliases
- `src/lib/email/alias.ts` (pure): `generateAlias(email, random)`, `formatAddress(alias, domain)`, `aliasFromRecipient(recipient, domain)` (lower-cases, trims, rejects the wrong domain and plus-addressing tricks).
- `src/lib/db/forwarding.ts` (user-scoped): `getOrCreateAlias(db, userId, email)` with collision retry, `rotateAlias(db, userId)`.
- `src/lib/db/inbound-sync.ts` (system-scope): `findUserIdByAlias(db, alias)`, plus the lint restriction and its guard test.
- Tests: slug rules (accents, long names, empty local part), alphabet, collision retry, rotation invalidates the old alias, the recipient parser table (wrong domain, uppercase, whitespace, `+tag`, display-name form).

Commit: `feat(email): per-user forwarding aliases`

### 4. Text utilities and the regex pass — `src/lib/email/`
- `html-to-text.ts`, `tracking-patterns.ts` (UPS checksum included), `gmail-confirmation.ts`.
- Table-driven tests: HTML entities, nested tables, scripts and styles stripped, links kept, truncation; every carrier format with valid and look-alike invalid numbers (order numbers, phone numbers, 12-digit prices); UPS checksum pass and fail; the Gmail confirmation subject and body variants, and a message from any other sender that merely says "Confirmation code".

Commit: `feat(email): html-to-text, carrier patterns, Gmail confirmation`

### 5. Extraction — `src/lib/email/extract/`
- `schema.ts` (zod, strict objects), `prompt.ts`, `types.ts` (`Extractor`), `claude.ts` (SDK, structured outputs, typed error handling, handles `stop_reason` of `max_tokens` and `refusal`), `fake.ts`, `index.ts` (`getExtractor()`), `validate.ts` (grounding, normalization, caps).
- Install `@anthropic-ai/sdk`.
- Saved API responses in `tests/fixtures/anthropic/`; MSW serves them; the real service is never called.
- Tests:
  - request shape (model `claude-haiku-4-5`, no `tools`, `temperature` 0, the email inside the delimiters, the untrusted-data instruction);
  - a valid response, and **malformed output rejected**: not JSON, wrong shape, extra fields, an over-long field, too many tracking numbers, wrong types, a refusal, a truncated response;
  - 401, 429 and 5xx map to typed, retry-appropriate errors;
  - grounding: a number not in the email is dropped; the same number with spaces or dashes is accepted; numbers are normalized and format-checked;
  - **injection:** an email telling the model to output another user's address, a fake tracking number, or "ignore previous instructions" yields only grounded numbers and no extra fields reach the pipeline.

Commit: `feat(email): Claude extraction with validation and grounding`

### 6. Inbound webhook and storage — `src/lib/email/receive.ts`, route
- `receiveInboundEmail({ db, rawBody, headers, now })` returns the response table above.
- `src/app/api/webhooks/inbound-email/route.ts`; `/api/webhooks/*` is already public, so no proxy change.
- `src/jobs/events.ts`: `requestEmailProcessing(emailId)`, best effort like `requestGeocoding`.
- Tests on PGlite: correct secret stores the email; missing, wrong and near-miss secrets give 401 and write nothing; malformed body 422; oversized 413; **unknown alias dropped** (200, zero rows); duplicate `messageId` stores one; the daily cap; logs never contain the body, subject, addresses or secret; the route passes the status through and a thrown error is a 500.

Commit: `feat(email): authenticated inbound email webhook`

### 7. Processing, orders and jobs
- `src/lib/email/process.ts` (`processInboundEmail`), `src/lib/email/retailer-key.ts`, `src/lib/db/orders.ts` (user-scoped plus the pipeline's write functions), `src/jobs/inbound-email.ts`: `process-inbound-email` (event), `inbound-email-sweep` (hourly: pending emails older than 5 minutes get an event), `inbound-email-cleanup` (daily: raw emails older than 30 days, unattached orders older than 90 days).
- `tests/fixtures/email/`: **at least 12 hand-written fixtures** (README says they are synthetic, modelled on each retailer's typical wording, not real emails): Amazon (order and shipping), Target, Walmart, eBay, Best Buy, Etsy, Apple, Nike, Home Depot, and three Shopify stores (including two with the same `#1001` order number). Each file has the email, the canned model output and the expected result.
- Tests (PGlite + `FakeProvider`):
  - every fixture produces the expected orders and shipments, and **every shipment is created through `TrackingProvider`** (spy);
  - **placeholder attach:** an order confirmation then the shipping email gives one shipment and one attached order; the reverse order of arrival works too;
  - two Shopify stores with the same order number don't attach to each other's placeholder;
  - a shipping email with no placeholder creates a shipped order row; two tracking numbers for one order give two shipments;
  - duplicate tracking number, invalid number and provider-rejected number are skipped without blocking the others; a provider outage fails the job (retry);
  - the job is idempotent (running it twice changes nothing);
  - **cross-user isolation:** user A's email, including one that names user B, never reads or writes B's rows (checked row by row in both directions);
  - degraded mode: the model failing for good marks the email `failed` and creates nothing;
  - cleanup deletes only emails older than 30 days and only unattached orders older than 90 days; the sweep picks only old pending emails.

Commit: `feat(email): process inbound emails into orders and shipments`

### 8. UI
- `/settings` page and components (address with copy, filter instructions, confirmation code, regenerate, failed count); header link; a server action for regenerating and one for dismissing an order, both taking the user only from `requireUser()`.
- "Ordered" section in the list (retailer, item, order number, relative time, Dismiss); the drawer shows "Ordered from {retailer} · #{order}" when an order is linked (read through the user-scoped shipment).
- Tests: the settings page shows the address for the signed-in user only and creates it once; regenerate changes it; the confirmation code appears only when recent; the Ordered section renders and sits before Delivered; dismiss deletes only the user's own order; the actions ignore any user id in the form; strings render as text, not HTML (a `<script>` in an item name is shown literally).

Commit: `feat(ui): settings page, Ordered section and order details`

### 9. Cloudflare Worker, docs and the live check
- `workers/inbound-email/` (`handler.ts`, `index.ts`, `wrangler.toml`, `package.json`, README) and its tests: the envelope recipient is forwarded (not `To:`), text and HTML are capped, oversized messages are skipped, the secret header is sent, a 5xx from the app throws so the sender retries, a 4xx is dropped quietly.
- `docs/email-forwarding-setup.md`: buy or pick a domain, put its DNS on Cloudflare, enable Email Routing on `in.<domain>`, deploy the Worker with `wrangler`, set `INBOUND_WEBHOOK_SECRET` on both sides and `INBOUND_EMAIL_DOMAIN` in the app, Gmail filter and forwarding confirmation, Outlook rule, local testing with `curl` and a fixture (no Cloudflare or domain needed).
- CLAUDE.md (Stack, folder layout, env keys, the two import restrictions, the untrusted-email rules), `docs/unresolved-issues.md` (see below).
- **Live check script, written but not run in this phase** (your decision, 2026-10-08): `npm run eval:email` runs a folder of emails through the real Haiku 4.5 and prints how many it got right. It reads the synthetic fixtures plus any real example emails you add later to `tests/fixtures/email/real/` (gitignored, so personal details never get committed). Running it spends a few cents, so it waits for your go-ahead; the deferral is logged in `docs/unresolved-issues.md` for the final sweep.

Commit: `feat(email): Cloudflare Worker, setup docs and live eval`

## Explicitly not in Phase 5

- Gmail/Outlook OAuth inbox sync (backlog; out of scope for the MVP)
- Notifications (Phase 6)
- Per-user package cap and rate limiting beyond the daily cap (Phase 7)
- A UI to browse or reprocess failed emails (a count only; the rest to Phase 7)
- Attachments (PDF invoices); only the email body is read
- Non-English emails beyond what the model handles on its own
- Switching to Postmark or another receiver
- Buying a domain or deploying the Worker (needs you; steps in the setup doc)

## Test gate (coverage target 90%)

- **Retailer fixtures:** 12+ fixtures (Amazon, Target, Walmart, eBay, Best Buy, Etsy, Apple, Nike, Home Depot, three Shopify stores) produce the expected orders and shipments, every shipment through `TrackingProvider`.
- **Malformed model output rejected:** not JSON, wrong shape, extra fields, over-long fields, too many numbers, refusal and truncation all create nothing.
- **Unknown address dropped:** 200, no rows, and no difference a prober could see.
- **Injection:** instructions inside an email can't create a shipment for another user, can't make the pipeline act on a tracking number that isn't in the email, and add no fields; user A's email never touches user B's rows.
- **Placeholders attach:** order-then-shipping and shipping-then-order both end with one shipment and one order; same order number at two stores doesn't cross-attach.
- **Old raw emails deleted:** only after 30 days.
- **Auth and idempotency:** 401 for any wrong secret; duplicate `messageId` stores once; the daily cap holds; logs hold no email content.
- **Checks:** `npm run lint`, `typecheck`, `test:coverage` (at least 90% on files touched in Phase 5; report the numbers) and `build` pass locally and in CI.
- **Finish:** push (ask first), confirm CI through the GitHub API, tag `phase-5-done`, and set CLAUDE.md "Current phase" to Phase 6. List deferred items in the summary.

## Verification (build session)

1. `npm test`: all green.
2. **Manual, no domain or Cloudflare needed** (`EMAIL_EXTRACTOR=fake`, `TRACKING_PROVIDER=fake`):
   1. Run `npm run dev` and `npm run jobs:dev`; open Settings and copy your address.
   2. `curl` the Amazon order-confirmation fixture to `/api/webhooks/inbound-email` with the dev secret: an "Ordered" row appears.
   3. `curl` the matching shipping fixture: the row becomes a tracked package, with the retailer in the drawer.
   4. `curl` to a made-up address: 200 and nothing happens. Send the same email twice: one package.
   5. `curl` the Gmail confirmation fixture: the code shows in Settings.
   6. Regenerate the address: the old one is dropped.
3. **Model accuracy: deferred** to the final sweep (see `docs/unresolved-issues.md`). Everything above uses mocked model output, so until `npm run eval:email` is run with real emails, what Haiku actually extracts is untested.
4. **Real forwarding** (needs a domain): follow `docs/email-forwarding-setup.md`, forward a real order email from Gmail, and check the confirmation-code step.
