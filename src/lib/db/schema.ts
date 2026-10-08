import { sql } from "drizzle-orm";
import {
  check,
  doublePrecision,
  index,
  integer,
  jsonb,
  pgEnum,
  pgTable,
  text,
  timestamp,
  unique,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";
// Relative import: drizzle-kit loads this file outside Next/Vitest, so no "@/" alias.
import { STATUSES } from "../tracking/status";

export const shipmentStatus = pgEnum("shipment_status", STATUSES);
export const parseStatus = pgEnum("parse_status", [
  "pending",
  "parsed",
  "failed",
  "ignored",
]);

const timestamptz = (name: string) => timestamp(name, { withTimezone: true });

/**
 * The key a free-text place is cached under: trimmed, lower-cased, inner
 * whitespace collapsed; null when blank. Computed by Postgres (generated
 * columns), so there is one definition and existing rows are backfilled. A
 * place geocoded later shows up on every shipment that mentions it.
 */
const placeKeySql = (column: string) =>
  sql.raw(
    `nullif(lower(regexp_replace(trim(${column}), '[[:space:]]+', ' ', 'g')), '')`,
  );

// RLS is enabled on every table with no policies: Supabase's Data API
// (anon/authenticated roles) is denied everything. The app itself connects as
// the table owner and enforces ownership in the query layer.
export const users = pgTable(
  "users",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    email: text("email").notNull().unique(),
    // Private forwarding address local part, e.g. "izaak-7f3k". Lower-case.
    forwardingAlias: text("forwarding_alias").unique(),
    createdAt: timestamptz("created_at").notNull().defaultNow(),
  },
  (t) => [
    check(
      "users_forwarding_alias_lowercase",
      sql`${t.forwardingAlias} = lower(${t.forwardingAlias})`,
    ),
  ],
).enableRLS();

export const shipments = pgTable(
  "shipments",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    trackingNumber: text("tracking_number").notNull(),
    courier: text("courier"),
    nickname: text("nickname"),
    provider: text("provider").notNull(),
    providerTrackerId: text("provider_tracker_id"),
    status: shipmentStatus("status").notNull().default("Pending"),
    eta: timestamptz("eta"),
    lastEventAt: timestamptz("last_event_at"),
    // Geocodable text for where the parcel is going (city, postcode, country).
    destinationText: text("destination_text"),
    destinationKey: text("destination_key").generatedAlwaysAs(
      placeKeySql("destination_text"),
    ),
    // When we last asked the provider (webhook or re-fetch), as opposed to
    // last_event_at, which is when the courier last scanned the parcel.
    lastSyncedAt: timestamptz("last_synced_at").notNull().defaultNow(),
    archivedAt: timestamptz("archived_at"),
    createdAt: timestamptz("created_at").notNull().defaultNow(),
    updatedAt: timestamptz("updated_at").notNull().defaultNow(),
  },
  (t) => [
    unique("shipments_user_tracking_number_unique").on(
      t.userId,
      t.trackingNumber,
    ),
    index("shipments_provider_tracker_idx").on(t.provider, t.providerTrackerId),
    // Partial indexes for the background jobs: only the rows they scan.
    index("shipments_sync_due_idx")
      .on(t.provider, t.lastSyncedAt)
      .where(
        sql`${t.archivedAt} is null and ${t.status} not in ('Delivered', 'Expired')`,
      ),
    index("shipments_archive_due_idx")
      .on(t.lastEventAt)
      .where(sql`${t.status} = 'Delivered' and ${t.archivedAt} is null`),
  ],
).enableRLS();

export const checkpoints = pgTable(
  "checkpoints",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    shipmentId: uuid("shipment_id")
      .notNull()
      .references(() => shipments.id, { onDelete: "cascade" }),
    providerEventId: text("provider_event_id").notNull(),
    occurredAt: timestamptz("occurred_at").notNull(),
    eventOrder: integer("event_order"),
    status: shipmentStatus("status").notNull(),
    message: text("message"),
    locationText: text("location_text"),
    // Joins to places.query_key. Coordinates live in places, not here.
    locationKey: text("location_key").generatedAlwaysAs(
      placeKeySql("location_text"),
    ),
    createdAt: timestamptz("created_at").notNull().defaultNow(),
  },
  (t) => [
    unique("checkpoints_shipment_event_unique").on(
      t.shipmentId,
      t.providerEventId,
    ),
    index("checkpoints_shipment_occurred_idx").on(t.shipmentId, t.occurredAt),
    index("checkpoints_location_key_idx").on(t.locationKey),
  ],
).enableRLS();

// A global geocode cache, not user data. lat/lng both null means "looked up,
// nothing found": un-geocodable text is remembered so it is never retried.
export const places = pgTable(
  "places",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    queryKey: text("query_key").notNull().unique(),
    lat: doublePrecision("lat"),
    lng: doublePrecision("lng"),
    displayName: text("display_name"),
    geocoder: text("geocoder").notNull().default("unknown"),
    createdAt: timestamptz("created_at").notNull().defaultNow(),
  },
  (t) => [
    check(
      "places_lat_lng_both_or_neither",
      sql`(${t.lat} is null) = (${t.lng} is null)`,
    ),
  ],
).enableRLS();

export const inboundEmails = pgTable(
  "inbound_emails",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    receivedAt: timestamptz("received_at").notNull().defaultNow(),
    // The normalized email as JSON text. Deleted with the row after 30 days.
    raw: text("raw").notNull(),
    // The sender's Message-ID: a forwarder can deliver the same email twice.
    messageId: text("message_id"),
    fromAddress: text("from_address"),
    subject: text("subject"),
    parseStatus: parseStatus("parse_status").notNull().default("pending"),
    extracted: jsonb("extracted"),
    createdAt: timestamptz("created_at").notNull().defaultNow(),
  },
  (t) => [
    index("inbound_emails_received_at_idx").on(t.receivedAt),
    uniqueIndex("inbound_emails_user_message_unique")
      .on(t.userId, t.messageId)
      .where(sql`${t.messageId} is not null`),
    // The hourly sweep looks for emails whose processing event never ran.
    index("inbound_emails_pending_idx")
      .on(t.receivedAt)
      .where(sql`${t.parseStatus} = 'pending'`),
  ],
).enableRLS();

// An order from a retailer, with or without a shipment yet. Without one it is
// the "Ordered" placeholder; the shipping email attaches it later.
export const orders = pgTable(
  "orders",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    retailer: text("retailer"),
    // Retailer name lower-cased with suffixes and punctuation removed. Order
    // numbers are only unique per retailer (many Shopify stores start at #1001).
    retailerKey: text("retailer_key"),
    item: text("item"),
    orderNumber: text("order_number"),
    // Deleting the shipment deletes its order row.
    shipmentId: uuid("shipment_id").references(() => shipments.id, {
      onDelete: "cascade",
    }),
    sourceEmailId: uuid("source_email_id").references(() => inboundEmails.id, {
      onDelete: "set null",
    }),
    createdAt: timestamptz("created_at").notNull().defaultNow(),
  },
  (t) => [
    // At most one placeholder per order...
    uniqueIndex("orders_placeholder_unique")
      .on(t.userId, t.retailerKey, t.orderNumber)
      .where(
        sql`${t.shipmentId} is null and ${t.retailerKey} is not null and ${t.orderNumber} is not null`,
      ),
    // ...and one order row per shipment.
    uniqueIndex("orders_shipment_unique")
      .on(t.shipmentId)
      .where(sql`${t.shipmentId} is not null`),
    index("orders_user_created_idx").on(t.userId, t.createdAt),
  ],
).enableRLS();
