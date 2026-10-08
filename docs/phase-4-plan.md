# Phase 4 — Map view and transport-mode icons: plan

Decisions: geocoder is Nominatim (OSM's public instance) behind a `Geocoder` interface; map tiles are OpenFreeMap (no key) (2026-10-07). New dependency: `maplibre-gl` only, which Stack already lists.


## Goal

A Map view next to the List view. Each package shows as a truck, plane, ship, van or pin icon at its latest known location, with a line through the checkpoints it has passed. Nearby packages cluster. Tapping an icon opens the existing detail drawer. A package with no locatable checkpoint shows a pin at its destination. If even that is unknown, it is listed under "Not on the map yet". Location text is turned into coordinates by a background job, using a geocoder that checks the `places` cache before going to the network.

## Facts that shape this design

Read 2026-10-07.

- **Ship24 gives us a destination.**
  - `shipment.destinationCountryCode`, plus `shipment.recipient`: `name`, `address`, `postCode`, `city`, `subdivision`.
  - Our zod schema strips all of these today.
  - Ship24 also *accepts* `destinationPostCode` and `destinationCountryCode` when a tracker is created. We already pass them through when given, but no UI collects them.
- **Event locations are free text,** for example `"MEMPHIS, TN"`, `"SAN RAFAEL, CA 94901"` or `"LOS ANGELES INTERNATIONAL AIRPORT, CA"`. They may also be null.
- **Nominatim (public instance):**
  - At most 1 request per second, with an identifying `User-Agent`.
  - No bulk geocoding and no autocomplete. Caching is expected.
  - Results are © OpenStreetMap, which the map's attribution already credits.
  - Its policy is "light use"; at launch we may move to a paid host. That is logged for Phase 7.
- **OpenFreeMap:** MapLibre styles at `https://tiles.openfreemap.org/styles/liberty`, with no key and no limits. It is community-run and has no SLA.
- **Inngest v4 has `throttle`** (runs are queued, not dropped) and `step.sendEvent`, and event `id`s are de-duplicated for 24 hours. Sending events in production needs `INNGEST_EVENT_KEY`.
- **MapLibre needs WebGL, which jsdom doesn't have.** Map tests mock `maplibre-gl`. All the real logic (GeoJSON building, mode inference) lives in pure functions.

## Dependencies

| Package | Why |
| --- | --- |
| `maplibre-gl` | The map (Stack: "Map: MapLibre GL"). Used directly; no React wrapper package. |

Nothing else. Nominatim is called with `fetch` + zod, and the icons are hand-made SVG.

## Design decisions

- **Coordinates are joined on read; nothing is copied.**
  - `checkpoints` gets a **generated** column `location_key = lower(regexp_replace(trim(location_text), '\s+', ' ', 'g'))`, stored and indexed.
  - `shipments` gets `destination_text` and a generated `destination_key` built the same way.
  - Map and detail queries `LEFT JOIN places ON places.query_key = location_key`.
  - Because Postgres computes the key, there is no TypeScript normalization that could drift from it, and existing rows are backfilled by the migration itself.
  - A place geocoded later appears on every shipment at once, with no backfill.
- **Drop `checkpoints.lat`, `checkpoints.lng`, `checkpoints.mode` and the `transport_mode` enum.**
  - Nothing has ever written them, and the join replaces them.
  - The mode is computed on read (next point), so improving the rules later needs no data migration.
  - `MODES` stays as a TypeScript constant.
- **`places` caches misses too.**
  - `lat` and `lng` become nullable. Null means "looked up, not found", so un-geocodable text is never retried.
  - A check constraint keeps both null or both set.
  - A `geocoder` column records which service answered.
  - Transient failures (network, 429, 5xx) write nothing and are retried.
- **Mode rules,** in the pure function `inferMode(current, previous)`. The previous checkpoint is the last one that has coordinates.

  | Checkpoint | Mode |
  | --- | --- |
  | Status `OutForDelivery` or `AttemptFail` | `van` |
  | Status `Pending`, `InfoReceived`, `Delivered`, `AvailableForPickup`, `Exception` or `Expired` | `pin` (not moving) |
  | `InTransit`, and the message or location mentions air travel: airport, air gateway/hub, airline, flight, aircraft, air freight/cargo, "by air" | `plane` |
  | `InTransit`, and it mentions sea travel: `\bport\b` (so not "airport", "Portland" or "transport"), vessel, ocean, sea freight, maritime, harbour/harbor, "by sea" | `ship` |
  | `InTransit`, and it is more than 800 km from the previous located checkpoint within 24 hours (haversine) | `plane` |
  | Any other `InTransit` | `truck` |

  A shipment's mode is its newest checkpoint's mode. The plan.md spec only fixed `van` for OutForDelivery; treating `AttemptFail` as `van` and the stationary statuses as `pin` are additions, flagged here. The drawer shows the mode as "best guess".
- **Map data is built by the pure function `buildMapData(shipments)`.** For each non-archived shipment:
  - **Has located checkpoints:** a point at the newest one, with `mode`. Plus a LineString through all located checkpoints, oldest to newest, skipping consecutive duplicates; only drawn when there are at least 2 distinct points.
  - **No located checkpoint, but a located destination:** a point at the destination, with `mode: "pin"` and `fallback: true`.
  - **Neither:** goes in `unplaced` and is shown under "Not on the map yet".
- **The geocoding pipeline runs on Inngest:**
  1. **`geocode-sweep`.** Triggers: the event `wayfind/geocode.requested` and an hourly backstop cron (`15 * * * *`); concurrency 1. It finds distinct `location_key`s and `destination_key`s that have no `places` row (up to 200) and sends one `wayfind/place.geocode` event per key, `{ key, text }`, with `id` = a SHA-1 of the key, so a burst of sweeps queues each key only once.
  2. **`geocode-place`.** `throttle: { limit: 1, period: "1s" }`, which keeps the whole app at Nominatim's 1 request per second. One `step.run` calls `geocodePlace(db, geocoder, key, text)`:
     - a `places` row exists (hit or cached miss): return, no network;
     - otherwise call the geocoder and insert the result or the miss (`on conflict do nothing`);
     - a transient error throws, and Inngest retries.
  3. **Who sends `geocode.requested`:** the webhook route when `newCheckpoints > 0`, the add-package action after a successful add, and the re-fetch job when `updated > 0` (via `step.sendEvent`).
     - Route and action sends are **best effort**: a failure is logged and ignored, never turned into a 500 (the hourly sweep catches it). Otherwise a send failure would make Ship24 retry a webhook we had already applied.
     - The helper `requestGeocoding()` lives in `src/jobs/events.ts`, so lib code never imports the Inngest client.
- **A system-scope query module for geocoding, `src/lib/db/geo-sync.ts`.** The sweep reads location keys across all users. It returns only location text, never shipment or user data. It joins the same ESLint import restriction as `tracker-sync`, and only `src/lib/geo/**` and `src/jobs/**` may import it. `places` itself is a global cache, not user data.
- **The `Geocoder` interface mirrors `TrackingProvider`:**
  - `geocode(query) → { lat, lng, displayName } | null`, plus `name`.
  - `NominatimGeocoder`:
    - fetch + zod, `format=jsonv2&limit=1`;
    - `User-Agent: Wayfind/0.1 (+<APP_URL>)`;
    - 429 or 5xx throws a retryable error; an empty array returns null.
  - `FakeGeocoder` (the default) has canned coordinates for every place the fake tracking scenarios use, plus their destinations; anything else is null.
  - It is chosen by `GEOCODER=fake|nominatim`, and ESLint stops code outside `src/lib/geo` from importing a specific geocoder. Dev and tests never touch the network unless you opt in.
- **Destinations come through the provider:**
  - `NormalizedShipment` gains `destination: string | null`. Each provider builds a geocodable string itself:
    - Ship24: `[city, subdivision, postCode, destinationCountryCode]` (non-empty parts, joined with ", "), falling back to the country code alone;
    - Fake: a fixed city per scenario, and `PENDING` has a destination but no events, to show the destination pin.
  - Stored as `shipments.destination_text` on create and on every update (the newest non-null value wins).
  - The shared contract suite checks the field.
- **The map is URL-driven, like the drawer:**
  - `/?view=map` renders the map and `/?view=map&shipment=<id>` adds the drawer.
  - A List / Map toggle (two links) sits above the content. The drawer's close goes back to the view it came from: it gets a `closeHref` prop.
  - The page loads map data only in map view, so the list view is unchanged.
- **The `ShipmentMap` client component:**
  - imports `maplibre-gl` dynamically inside `useEffect` (no SSR or `window` problems), with the OpenFreeMap "liberty" style;
  - registers the 5 mode SVGs as map images;
  - GeoJSON point source with `cluster: true`: cluster circles with a count, and a symbol layer `icon-image: ["concat", "mode-", ["get", "mode"]]` for single shipments;
  - a line layer for routes;
  - fits the view to all points;
  - clicking a shipment pushes `?view=map&shipment=<id>`; clicking a cluster zooms in.

  Below the map there is an accessible list: "On the map" (icon, name, link to the drawer) and "Not on the map yet". The map is never the only way to reach a package.
- **One icon source:** `src/components/mode-icons.tsx` holds the SVG path data per mode. `<ModeIcon mode>` renders it inline with `data-mode` and a `<title>`. The map turns the same data into images, so the map and the page can't disagree.
- **Env:**
  - `GEOCODER` (`fake` default | `nominatim`);
  - `INNGEST_EVENT_KEY` (required in production, the same pattern as `INNGEST_SIGNING_KEY`).

  Claude can't edit `.env.example`, so the build session hands you the lines to paste.
- **Privacy:** checkpoint locations and destinations (city, postcode, country, never the recipient's name or street) are sent to Nominatim. This is logged for the Phase 7 privacy policy.

## Steps (one commit each)

### 1. Schema (own commit, before feature code)
- Load the `supabase-postgres-best-practices` skill.
- `checkpoints`: add the generated, stored `location_key` and an index on it; drop `lat`, `lng` and `mode`.
- `shipments`: add `destination_text`, plus the generated, stored `destination_key`.
- `places`: make `lat` and `lng` nullable, add the both-or-neither check constraint, and add `geocoder text not null default 'unknown'`.
- Drop the `transport_mode` enum.
- `npm run db:generate`, then read the SQL. The generated expressions must be immutable, and the drops must be the only destructive statements.
- Tests (PGlite):
  - the key expression on a table of strings (case, inner and outer whitespace, null);
  - existing rows are backfilled;
  - the check constraint rejects a half-filled place.
- Fix any fixtures that break.

Commit: `feat(db): location keys, destination, nullable places; drop unused coordinate columns`

### 2. Provider destination
- `NormalizedShipment.destination`.
- Ship24: add `recipient` and `destinationCountryCode` to the zod schema, and the mapping. Add the field to fixtures `track-*.json` and `webhook-events.json`.
- Fake: a destination per scenario.
- `contract.ts`: assert the field.
- Store it: `NewShipment` and `addShipment` set `destinationText`; `applyTrackerUpdate` sets it when the incoming value isn't null.
- Tests:
  - Ship24 mapping: full recipient, country only, none;
  - every fake scenario's destination;
  - the contract passes for both providers;
  - add and webhook store the destination, and an update with null keeps it.

Commit: `feat(tracking): provider destinations stored on shipments`

### 3. Geo math and mode rules — `src/lib/geo/`
- `distance.ts`: `haversineKm`.
- `infer-mode.ts`: `inferMode(current, previous)` and `shipmentMode(checkpointsOldestFirst)`.
- Tests:
  - haversine on known city pairs;
  - **table-driven `inferMode`, 30+ realistic cases:**
    - USPS, UPS, FedEx, DHL, China Post and Royal Mail style strings;
    - word-boundary traps: "Portland", "airport", "transport", "import";
    - hops of 799 / 801 km at 23 h / 25 h;
    - every status in the status table;
  - `shipmentMode` picks the newest checkpoint and uses the previous *located* checkpoint for the hop.

Commit: `feat(geo): transport-mode inference`

### 4. Geocoder — `src/lib/geo/geocoder/`
- `types.ts` (the interface and `GeocoderError` with `retryable`), `nominatim.ts`, `fake.ts`, and `index.ts` (`createGeocoder(env)`, `getGeocoder()`).
- `env.ts`: add `GEOCODER` and `INNGEST_EVENT_KEY`, and their tests.
- ESLint: a geocoder-adapter pattern like the provider one, plus a lint-guard test.
- MSW fixtures in `tests/fixtures/nominatim/`: a hit, empty, malformed, 429 and 500.
- Tests:
  - request shape: query encoding, `format`, `limit`, `User-Agent`;
  - a hit gives numbers (Nominatim returns strings);
  - empty gives null;
  - malformed throws non-retryable;
  - 429 and 5xx throw retryable;
  - the fake geocoder's table;
  - env selection.

Commit: `feat(geo): Nominatim and fake geocoders`

### 5. Geocoding pipeline
- **`src/lib/db/geo-sync.ts`:** `findPendingPlaces(db, limit)` (distinct keys plus original text, from checkpoints and destinations, without a `places` row) and `savePlace(db, key, result | null, geocoder)`. Add both to the lint restriction.
- **`src/lib/geo/geocode-place.ts`:** `geocodePlace(...)`, cache-first.
- **`src/jobs/geocode.ts`:** the `geocode-sweep` and `geocode-place` functions. **`src/jobs/events.ts`:** `requestGeocoding()`.
- **Wiring:**
  - `src/app/api/webhooks/tracking/route.ts`: best-effort send when `newCheckpoints > 0`;
  - `src/app/actions.ts`: best-effort send after a successful add;
  - `src/jobs/refetch-stale.ts`: `step.sendEvent` when `updated > 0`.
- **Tests:**
  - **Cache-first (spy geocoder):** a cached hit or a cached miss makes no call; a new hit and a new miss are stored; a transient error stores nothing and rethrows.
  - **`findPendingPlaces`:** only uncached keys, distinct across users and checkpoints, includes destinations, respects the limit.
  - **Inngest functions:**
    - the sweep sends one event per key with a stable `id`;
    - `geocode-place` has the 1/s throttle and calls the lib;
    - both cron and event triggers are present.
  - **Route and action:** they send only when there is something new, a send failure doesn't change the response, and nothing sensitive is logged.

Commit: `feat(geo): cache-first geocoding jobs`

### 6. Map data
- `src/lib/db/shipments.ts` (user-scoped, as always):
  - `listMapShipments(db, userId)`: non-archived shipments, each with its destination coordinates and its checkpoints (oldest first) joined to `places`.
  - `getShipmentDetail` also returns each checkpoint's coordinates, which the drawer's mode needs.
- `src/lib/geo/map-data.ts`: `buildMapData`.
- Tests:
  - **PGlite ownership:** user B's map never contains user A's shipments; archived shipments are excluded; coordinates come from `places`; a cached miss is treated as no location.
  - **`buildMapData`:**
    - the point sits at the newest located checkpoint;
    - the route is in time order, de-duplicated, and has at least 2 points;
    - **the destination fallback pin when nothing is located;**
    - `unplaced` when neither is located;
    - mode per shipment.

Commit: `feat(map): map data with destination fallback`

### 7. UI
- `mode-icons.tsx` (`ModeIcon` + SVG data), `view-toggle.tsx`, and `shipment-map.tsx` (client, as designed).
- `page.tsx` handles `?view=map`.
- `shipment-drawer.tsx`: `closeHref`, plus a "Best guess: by truck" line with `ModeIcon`.
- `maplibre-gl/dist/maplibre-gl.css` is imported by the map component.
- Tests (Testing Library, `maplibre-gl` mocked with a fake `Map` that records sources, layers, images and handlers):
  - **`ModeIcon`:** each of the 5 modes renders its own icon and title (**correct icon per mode**).
  - **`ShipmentMap`:**
    - all 5 images are registered, and the clustered source and layers are added;
    - the icon expression uses `mode`;
    - clicking a shipment pushes `?view=map&shipment=<id>`; clicking a cluster zooms;
    - "On the map" and "Not on the map yet" lists render with links;
    - the style URL is OpenFreeMap's;
    - no network (MSW `onUnhandledRequest: "error"`).
  - **`ViewToggle`:** marks the active view.
  - **Page:** list by default, map with `?view=map`, and the drawer still opens in both views and closes back to the right one.
  - **Drawer:** the "best guess" line.

Commit: `feat(map): map view, mode icons and list/map toggle`

### 8. Docs
- **CLAUDE.md:**
  - Stack: geocoder Nominatim (decided in Phase 4) behind `Geocoder`; tiles OpenFreeMap.
  - Folder layout: `lib/geo/` (geocoder, infer-mode, map-data) and `lib/db/geo-sync.ts`.
  - Env keys: `GEOCODER` and `INNGEST_EVENT_KEY`.
  - The geocoder import rule.
- **`docs/webhooks-and-jobs-setup.md`:** the geocode functions, `INNGEST_EVENT_KEY`, trying the map locally with `GEOCODER=fake`, and switching to `nominatim`.
- **Hand the user** the `.env.example` lines (`GEOCODER=fake`, `INNGEST_EVENT_KEY=`).
- **`docs/unresolved-issues.md`** (per the deferral rule):
  - Phase 7: Nominatim "light use" at launch volume; OpenFreeMap has no SLA; privacy policy must mention location data sent to OSM.
  - Final sweep: ambiguous place names (e.g. "PARIS" TX vs France; no country bias yet); country-only locations pin at the country's centroid.
  - Backlog: let users enter their own destination when the provider has none.

Commit: `docs: Phase 4 map and geocoding`

## Explicitly not in Phase 4

- Live map updates (the page shows new data on reload)
- User-entered destinations or address book (logged to the backlog)
- Country biasing or disambiguation of place names (final sweep)
- Notifications and the PWA (Phase 6)
- Swapping to a paid geocoder or tile host (Phase 7, if needed)

## Test gate (coverage target 85%)

- **`inferMode`:** table-driven, 30+ realistic checkpoint strings and hop distances (799/801 km, 23/25 h), plus every status.
- **Geocoder cache-first:** cached hits and cached misses make no network call; new results and misses are stored; transient errors store nothing.
- **Destination fallback:** a shipment with no located checkpoint gets a `pin` at its destination; with neither, it is listed as not on the map.
- **Correct icon per mode:** `ModeIcon` for all 5 modes, and the map registers all 5 images and keys `icon-image` on `mode`.
- **Ownership:** map data is user-scoped (PGlite, two users); `geo-sync` and specific geocoders can't be imported from `src/app/**` (lint-guard test).
- **No real network in tests:** Nominatim only through MSW fixtures; the map with `maplibre-gl` mocked.
- **Checks:** `npm run lint`, `typecheck`, `test:coverage` (at least 85% on files touched in Phase 4; report the numbers) and `build` pass locally and in CI.
- **Finish:** push (ask first), confirm CI through the GitHub API, tag `phase-4-done`, and set CLAUDE.md "Current phase" to Phase 5. List any deferred items in the summary.

## Verification (build session)

1. `npm test`: all green.
2. **Manual, fake provider and fake geocoder:**
   1. Run `npm run dev` and `npm run jobs:dev`.
   2. Add `FAKE-TRANSIT-1`, `FAKE-AIR-1`, `FAKE-OFD-1`, `FAKE-DELIVERED-1` and `FAKE-PENDING-1`.
   3. Within seconds the Inngest UI shows `geocode-sweep`, then one `geocode-place` per new location, about 1 per second.
   4. Switch to Map:
      - truck, plane, van and pin icons sit at the right cities, with route lines;
      - `FAKE-PENDING-1` shows a destination pin;
      - zooming out clusters the icons;
      - tapping an icon opens the drawer with a "best guess" line, and closing it returns to the map.
   5. Run `geocode-sweep` again: no new `geocode-place` runs (cache).
3. **Optional, real Nominatim:** set `GEOCODER=nominatim`, add one package, and confirm a single request per new place in the logs and a stored `places` row. Watch the 1/s throttle.
