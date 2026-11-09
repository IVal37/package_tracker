# Order status from emails with no tracking number

## Context

A forwarded Amazon "Shipped" email (7 Nov 2026) carries the order number, the item, "Shipped" and "Arriving tomorrow", but **no carrier tracking number**: only a "Track package" button. Wayfind creates a package only from a tracking number, so the email is read, finds nothing to track, is marked `parsed` and shows nothing. The user expects every forwarded order to appear.

Ship24 (and any tracking API) tracks carrier numbers; it cannot look a package up by retailer order number. So the number cannot be found for this email. What the email does tell us is the order's stage and the retailer's own delivery estimate. This plan shows that, honestly labelled as "from the email", with no live map.

This is outside Phase 7 (the user chose it explicitly on 8 Nov 2026). Linking an Amazon or Gmail account stays out of scope for the MVP.

## Behaviour

- A shipping or delivery email with an order number but no usable tracking number becomes an entry in the list, built only from the email: item, retailer, order number, stage (Ordered, Shipped, Delivered) and the estimate as the email words it ("Arriving tomorrow").
- It says where the information comes from and when ("from an email 20 hours ago"), because "Arriving tomorrow" goes stale. It has no map pin, no checkpoints, no alerts.
- If a later email for the same order carries a tracking number, the entry becomes the real tracked package, as an "Ordered" placeholder does today. A package the user adds by hand is not linked to the entry (the Add form has no order number), so the user dismisses the entry.
- Nothing changes for emails that already produce a package.

## Design

### Data (own commit, first, before feature code)

Add to `orders` (migration via `npm run db:generate`):

- `stage text not null default 'ordered'`, one of `ordered | shipped | delivered`, checked by a Postgres check constraint and a zod enum.
- `eta_text text null`: the estimate as written, at most 60 characters.
- `stage_at timestamptz null`: when the email that set the stage was received.

The existing unique indexes stay valid: an email-only order is still a row with `shipment_id` null, unique per `(user, retailer_key, order_number)`. Existing rows get `stage = 'ordered'`.

### Extraction

- Add one field to the model's answer: `delivery_estimate`, the retailer's estimate as worded in the email, or null. Add it to `extractionSchema` (max 60, optional text), `apiSchema`, the prompt and `fake.ts`. The stage is **not** a model field: it comes from `email_type` (`order_confirmation` -> ordered, `shipping_confirmation` -> shipped, `delivery_update` -> delivered), so the model has no new way to influence state.
- `delivery_estimate` is untrusted email text: `cleanDisplayText`, rendered as React text only, never a link or HTML.
- Update `tests/fixtures/email/retailers.json` and add an Amazon shipped example **without** a tracking number, modelled on the real email (order number, "Track package", "Arriving tomorrow"). The existing Amazon fixtures keep their tracking line, since some emails have it. `npm run eval:email` scores the new field.

### Processing (`src/lib/email/process.ts`)

- After the tracking loop, if no shipment was created or matched (no numbers, or every number came back `not_found`/`invalid`) **and** the email has both a retailer key and an order number, record the stage on the order. Otherwise do nothing, as today.
- The rule is a pure function, `decideOrderStage` in `src/lib/email/order-stage.ts`. Like `decideShipmentUpdate`, it goes by event time, never by ranking stages: the email's received time (set by our webhook, not the email's own headers) must be newer than `stage_at`. A late older email is stored but changes nothing. Delivered is not "higher" than shipped; it just arrived later.
- DB: a new `recordOrderStage` in `src/lib/db/orders.ts` (userId-scoped). It finds the order by key, or creates it, and updates only where `stage_at` is null or older. An order with a `shipment_id` is never touched.
- `loadInboundEmail` also returns `receivedAt` (it stays in `inbound-sync.ts`, which is system-scope and returns nothing that is rendered).
- Limit and outage outcomes (`limit_reached`, `unavailable`) do not fall back. The cap is the user's to resolve, and an outage is retried.

### List (`src/components/shipment-list.tsx`, `src/app/page.tsx`)

- `OrderedItem` gains `stage`, `etaText`, `stageAt`.
- Orders are split by stage: a new section **"Shipped, no tracking number"** just before Ordered (it is the more useful of the two), then "Ordered" as today. Each row shows the item, retailer and order number, then "Arriving tomorrow · from an email 20 hours ago". The Ordered section's "Waiting for a shipping email" line stays for `ordered`.
- A `delivered` entry shows in the same section with "Delivered · from an email", and is removed by the existing daily cleanup after 14 days (shipped and ordered keep the 90-day rule). Dismiss works on all of them (`dismissOrder` already deletes only rows without a shipment).
- `listOrderPlaceholders` is unchanged in what it selects, plus the three new columns.

### Other places that touch orders

- Export (`src/lib/db/export.ts`, `src/lib/privacy/export.ts`): the three columns are included automatically from the row type; extend the export test.
- Privacy and legal pages: the model already reads these emails and the text is covered. Check `src/lib/legal/services.ts` needs no change (no new service).
- `CLAUDE.md`: one line under the email module and a line in the orders rule. Setup page: one sentence under Gmail saying some retailers, Amazon included, leave the tracking number out, and then Wayfind shows the order's status from the email.

## Not doing

- No tracking-by-order-number, no Amazon or Gmail account link, no scraping the "Track package" link (it needs a signed-in Amazon session and is untrusted input).
- No alerts or map pin for email-only entries.
- No change to the Ship24 provider or the `Status` enum. Email stages are a separate field and never feed `decideShipmentUpdate`.

## Tests

- Unit: `decideOrderStage` (newer wins, older ignored, same time, null `stage_at`), extraction schema with and without the field, prompt text.
- DB (PGlite): `recordOrderStage` creates, updates, ignores older, never touches an order with a shipment, and is scoped by `userId`.
- `process.ts`: the real Amazon-shaped email -> one order at `shipped` with `eta_text`; the same email twice -> one row; ordered then shipped then delivered updates one row; shipped email later followed by one with a tracking number attaches the shipment; an email with no order number and no tracking number -> nothing.
- Component: sections, labels, text-only rendering of an estimate that contains markup, dismiss.
- Cleanup: delivered email-only orders at 14 days, others at 90.
- Run `npm run lint`, `typecheck`, `test`, `build`, and the e2e launch test.

## Order of work (small commits)

1. Plan (this file).
2. Migration and schema (alone).
3. `decideOrderStage` and `recordOrderStage`, with tests.
4. Extraction field, prompt, fixtures, fake extractor.
5. `process.ts` fallback.
6. List and page.
7. Cleanup, export, docs.
