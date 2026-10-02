import {
  doublePrecision,
  index,
  integer,
  jsonb,
  pgEnum,
  pgTable,
  text,
  timestamp,
  unique,
  uuid,
} from "drizzle-orm/pg-core";
// Relative import: drizzle-kit loads this file outside Next/Vitest, so no "@/" alias.
import { MODES, STATUSES } from "../tracking/status";

export const shipmentStatus = pgEnum("shipment_status", STATUSES);
export const transportMode = pgEnum("transport_mode", MODES);
export const parseStatus = pgEnum("parse_status", [
  "pending",
  "parsed",
  "failed",
  "ignored",
]);

const timestamptz = (name: string) => timestamp(name, { withTimezone: true });

export const users = pgTable("users", {
  id: uuid("id").primaryKey().defaultRandom(),
  email: text("email").notNull().unique(),
  forwardingAlias: text("forwarding_alias").unique(),
  createdAt: timestamptz("created_at").notNull().defaultNow(),
});

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
  ],
);

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
    lat: doublePrecision("lat"),
    lng: doublePrecision("lng"),
    mode: transportMode("mode"),
    createdAt: timestamptz("created_at").notNull().defaultNow(),
  },
  (t) => [
    unique("checkpoints_shipment_event_unique").on(
      t.shipmentId,
      t.providerEventId,
    ),
    index("checkpoints_shipment_occurred_idx").on(t.shipmentId, t.occurredAt),
  ],
);

export const places = pgTable("places", {
  id: uuid("id").primaryKey().defaultRandom(),
  queryKey: text("query_key").notNull().unique(),
  lat: doublePrecision("lat").notNull(),
  lng: doublePrecision("lng").notNull(),
  displayName: text("display_name"),
  createdAt: timestamptz("created_at").notNull().defaultNow(),
});

export const inboundEmails = pgTable(
  "inbound_emails",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    receivedAt: timestamptz("received_at").notNull().defaultNow(),
    raw: text("raw").notNull(),
    parseStatus: parseStatus("parse_status").notNull().default("pending"),
    extracted: jsonb("extracted"),
    createdAt: timestamptz("created_at").notNull().defaultNow(),
  },
  (t) => [index("inbound_emails_received_at_idx").on(t.receivedAt)],
);
