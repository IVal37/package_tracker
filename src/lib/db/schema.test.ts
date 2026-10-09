// @vitest-environment node
import { eq } from "drizzle-orm";
import { getTableConfig, type PgTable } from "drizzle-orm/pg-core";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  createTestDb,
  insertShipment,
  insertUser,
} from "../../../tests/db/pglite";
import {
  checkpoints,
  inboundEmails,
  notificationSettings,
  notifications,
  orders,
  places,
  pushSubscriptions,
  shipments,
  users,
} from "./schema";

let ctx: Awaited<ReturnType<typeof createTestDb>>;

beforeAll(async () => {
  ctx = await createTestDb();
});

afterAll(async () => {
  await ctx.client.close();
});

const checkpointValues = (shipmentId: string, providerEventId: string) => ({
  shipmentId,
  providerEventId,
  occurredAt: new Date("2026-01-01T00:00:00Z"),
  status: "InTransit" as const,
});

describe("schema (PGlite)", () => {
  it("applies the migrations and creates all tables", async () => {
    const result = await ctx.client.query<{ table_name: string }>(
      "select table_name from information_schema.tables where table_schema = 'public' order by table_name",
    );
    const names = result.rows.map((r) => r.table_name);
    expect(names).toEqual(
      expect.arrayContaining([
        "checkpoints",
        "inbound_emails",
        "places",
        "shipments",
        "users",
      ]),
    );
  });

  it("enables row-level security on every table", async () => {
    const result = await ctx.client.query<{
      relname: string;
      relrowsecurity: boolean;
    }>(
      `select c.relname, c.relrowsecurity
         from pg_class c
         join pg_namespace n on n.oid = c.relnamespace
        where n.nspname = 'public' and c.relkind = 'r'`,
    );
    const tables = result.rows.map((r) => r.relname).sort();
    expect(tables).toEqual([
      "checkpoints",
      "inbound_emails",
      "notification_settings",
      "notifications",
      "orders",
      "places",
      "push_subscriptions",
      "shipments",
      "users",
    ]);
    expect(result.rows.every((r) => r.relrowsecurity)).toBe(true);
  });

  it("has a NOT NULL last_synced_at that defaults to now", async () => {
    const column = await ctx.client.query<{
      is_nullable: string;
      column_default: string | null;
    }>(
      `select is_nullable, column_default from information_schema.columns
        where table_name = 'shipments' and column_name = 'last_synced_at'`,
    );
    expect(column.rows[0]?.is_nullable).toBe("NO");
    expect(column.rows[0]?.column_default).toContain("now()");

    const user = await insertUser(ctx.db);
    const shipment = await insertShipment(ctx.db, user.id);
    expect(shipment.lastSyncedAt).toBeInstanceOf(Date);
  });

  it("creates partial indexes for the sync and archive jobs", async () => {
    const result = await ctx.client.query<{
      indexname: string;
      indexdef: string;
    }>(
      `select indexname, indexdef from pg_indexes
        where tablename = 'shipments' and indexname like 'shipments_%_due_idx'
        order by indexname`,
    );
    const byName = (name: string) =>
      result.rows.find((row) => row.indexname === name);
    expect(result.rows.map((row) => row.indexname)).toEqual([
      "shipments_archive_due_idx",
      "shipments_eta_due_idx",
      "shipments_sync_due_idx",
    ]);
    expect(byName("shipments_archive_due_idx")?.indexdef).toMatch(
      /WHERE .*Delivered/,
    );
    expect(byName("shipments_sync_due_idx")?.indexdef).toMatch(
      /WHERE .*archived_at IS NULL/,
    );
    // The overdue-delay scan: only rows that have an ETA and can still be late.
    expect(byName("shipments_eta_due_idx")?.indexdef).toMatch(
      /WHERE .*archived_at IS NULL.*eta IS NOT NULL/,
    );
  });

  it("no longer stores coordinates or a mode on checkpoints", async () => {
    const columns = await ctx.client.query<{ column_name: string }>(
      `select column_name from information_schema.columns
        where table_name = 'checkpoints'`,
    );
    const names = columns.rows.map((r) => r.column_name);
    expect(names).toContain("location_key");
    expect(names).not.toContain("lat");
    expect(names).not.toContain("lng");
    expect(names).not.toContain("mode");

    const enums = await ctx.client.query<{ typname: string }>(
      `select typname from pg_type where typname = 'transport_mode'`,
    );
    expect(enums.rows).toHaveLength(0);
  });

  describe("place keys", () => {
    const cases: [string, string | null, string | null][] = [
      ["lower-cases", "MEMPHIS, TN", "memphis, tn"],
      ["trims the ends", "  Chicago, IL  ", "chicago, il"],
      [
        "collapses inner whitespace",
        "San   Rafael,\tCA\n94901",
        "san rafael, ca 94901",
      ],
      [
        "keeps punctuation and digits",
        "LOS ANGELES INTERNATIONAL AIRPORT, CA",
        "los angeles international airport, ca",
      ],
      ["is null for blank text", "   ", null],
      ["is null for empty text", "", null],
      ["is null for null text", null, null],
    ];

    it.each(cases)("checkpoint location_key %s", async (_name, text, key) => {
      const user = await insertUser(ctx.db);
      const shipment = await insertShipment(ctx.db, user.id);
      const [row] = await ctx.db
        .insert(checkpoints)
        .values({
          ...checkpointValues(shipment.id, `key-${Math.random()}`),
          locationText: text,
        })
        .returning();
      expect(row?.locationKey).toBe(key);
    });

    it("shipment destination_key uses the same rule", async () => {
      const user = await insertUser(ctx.db);
      const [row] = await ctx.db
        .insert(shipments)
        .values({
          userId: user.id,
          trackingNumber: `DEST-${Math.random()}`,
          provider: "fake",
          destinationText: "  Oakland,  CA 94601 ",
        })
        .returning();
      expect(row?.destinationKey).toBe("oakland, ca 94601");
    });

    it("indexes checkpoints.location_key", async () => {
      const result = await ctx.client.query(
        `select 1 from pg_indexes where indexname = 'checkpoints_location_key_idx'`,
      );
      expect(result.rows).toHaveLength(1);
    });
  });

  describe("places", () => {
    it("accepts a hit and a remembered miss", async () => {
      await expect(
        ctx.db.insert(places).values([
          { queryKey: "hit-1", lat: 41.88, lng: -87.63, geocoder: "fake" },
          { queryKey: "miss-1", lat: null, lng: null, geocoder: "fake" },
        ]),
      ).resolves.toBeDefined();
    });

    it("rejects a half-filled place", async () => {
      await expect(
        ctx.db.insert(places).values({ queryKey: "half-1", lat: 1, lng: null }),
      ).rejects.toThrow();
      await expect(
        ctx.db.insert(places).values({ queryKey: "half-2", lat: null, lng: 1 }),
      ).rejects.toThrow();
    });

    it("records which geocoder answered, defaulting to unknown", async () => {
      const [row] = await ctx.db
        .insert(places)
        .values({ queryKey: "default-geocoder", lat: 1, lng: 1 })
        .returning();
      expect(row?.geocoder).toBe("unknown");
    });
  });

  it("defaults shipment status to Pending", async () => {
    const user = await insertUser(ctx.db);
    const shipment = await insertShipment(ctx.db, user.id);
    expect(shipment.status).toBe("Pending");
    expect(shipment.archivedAt).toBeNull();
  });

  it("rejects a duplicate (user_id, tracking_number)", async () => {
    const user = await insertUser(ctx.db);
    await insertShipment(ctx.db, user.id, "DUPLICATE123");
    await expect(
      insertShipment(ctx.db, user.id, "DUPLICATE123"),
    ).rejects.toThrow();
  });

  it("allows the same tracking number for different users", async () => {
    const a = await insertUser(ctx.db);
    const b = await insertUser(ctx.db);
    await insertShipment(ctx.db, a.id, "SHARED12345");
    await expect(
      insertShipment(ctx.db, b.id, "SHARED12345"),
    ).resolves.toBeDefined();
  });

  it("rejects a duplicate (shipment_id, provider_event_id)", async () => {
    const user = await insertUser(ctx.db);
    const shipment = await insertShipment(ctx.db, user.id);
    await ctx.db
      .insert(checkpoints)
      .values(checkpointValues(shipment.id, "evt-1"));
    await expect(
      ctx.db.insert(checkpoints).values(checkpointValues(shipment.id, "evt-1")),
    ).rejects.toThrow();
  });

  it("cascades user deletion to shipments and checkpoints", async () => {
    const user = await insertUser(ctx.db);
    const shipment = await insertShipment(ctx.db, user.id);
    await ctx.db
      .insert(checkpoints)
      .values(checkpointValues(shipment.id, "evt-c"));

    await ctx.db.delete(users).where(eq(users.id, user.id));

    expect(
      await ctx.db
        .select()
        .from(shipments)
        .where(eq(shipments.id, shipment.id)),
    ).toHaveLength(0);
    expect(
      await ctx.db
        .select()
        .from(checkpoints)
        .where(eq(checkpoints.shipmentId, shipment.id)),
    ).toHaveLength(0);
  });
});

describe("orders (placeholders and shipments)", () => {
  const placeholder = (
    userId: string,
    retailerKey: string | null,
    orderNumber: string | null,
  ) => ({ userId, retailer: "Shop", retailerKey, orderNumber });

  it("allows one placeholder per user, retailer and order number", async () => {
    const user = await insertUser(ctx.db);
    await ctx.db.insert(orders).values(placeholder(user.id, "amazon", "111"));
    await expect(
      ctx.db.insert(orders).values(placeholder(user.id, "amazon", "111")),
    ).rejects.toThrow();
  });

  it("allows the same order number at a different retailer or for another user", async () => {
    const a = await insertUser(ctx.db);
    const b = await insertUser(ctx.db);
    await ctx.db.insert(orders).values(placeholder(a.id, "storeone", "1001"));
    await expect(
      ctx.db.insert(orders).values(placeholder(a.id, "storetwo", "1001")),
    ).resolves.toBeDefined();
    await expect(
      ctx.db.insert(orders).values(placeholder(b.id, "storeone", "1001")),
    ).resolves.toBeDefined();
  });

  it("does not limit placeholders that can never match (no retailer or no order number)", async () => {
    const user = await insertUser(ctx.db);
    await ctx.db.insert(orders).values(placeholder(user.id, null, "5"));
    await expect(
      ctx.db.insert(orders).values(placeholder(user.id, null, "5")),
    ).resolves.toBeDefined();
    await ctx.db.insert(orders).values(placeholder(user.id, "shop", null));
    await expect(
      ctx.db.insert(orders).values(placeholder(user.id, "shop", null)),
    ).resolves.toBeDefined();
  });

  it("allows several shipped orders with the same number but one order row per shipment", async () => {
    const user = await insertUser(ctx.db);
    const first = await insertShipment(ctx.db, user.id);
    const second = await insertShipment(ctx.db, user.id);
    const shipped = (shipmentId: string) => ({
      ...placeholder(user.id, "amazon", "222"),
      shipmentId,
    });

    await ctx.db.insert(orders).values(shipped(first.id));
    await expect(
      ctx.db.insert(orders).values(shipped(second.id)),
    ).resolves.toBeDefined();
    await expect(
      ctx.db.insert(orders).values(shipped(first.id)),
    ).rejects.toThrow();
  });

  it("deletes an order row with its shipment, and keeps one when its email is deleted", async () => {
    const user = await insertUser(ctx.db);
    const shipment = await insertShipment(ctx.db, user.id);
    const [email] = await ctx.db
      .insert(inboundEmails)
      .values({ userId: user.id, raw: "{}" })
      .returning();
    const [order] = await ctx.db
      .insert(orders)
      .values({
        ...placeholder(user.id, "amazon", "333"),
        shipmentId: shipment.id,
        sourceEmailId: email!.id,
      })
      .returning();

    await ctx.db.delete(inboundEmails).where(eq(inboundEmails.id, email!.id));
    const kept = await ctx.db
      .select()
      .from(orders)
      .where(eq(orders.id, order!.id));
    expect(kept[0]?.sourceEmailId).toBeNull();

    await ctx.db.delete(shipments).where(eq(shipments.id, shipment.id));
    expect(
      await ctx.db.select().from(orders).where(eq(orders.id, order!.id)),
    ).toHaveLength(0);
  });
});

describe("inbound_emails", () => {
  it("stores each message id once per user, but allows it for another user", async () => {
    const a = await insertUser(ctx.db);
    const b = await insertUser(ctx.db);
    const email = (userId: string, messageId: string | null) => ({
      userId,
      raw: "{}",
      messageId,
    });

    await ctx.db.insert(inboundEmails).values(email(a.id, "<m1@example.test>"));
    await expect(
      ctx.db.insert(inboundEmails).values(email(a.id, "<m1@example.test>")),
    ).rejects.toThrow();
    await expect(
      ctx.db.insert(inboundEmails).values(email(b.id, "<m1@example.test>")),
    ).resolves.toBeDefined();
  });

  it("does not constrain emails that have no message id", async () => {
    const user = await insertUser(ctx.db);
    await ctx.db.insert(inboundEmails).values([
      { userId: user.id, raw: "{}", messageId: null },
      { userId: user.id, raw: "{}", messageId: null },
    ]);
  });
});

describe("users.forwarding_alias", () => {
  it("must be lower-case", async () => {
    const user = await insertUser(ctx.db);
    await expect(
      ctx.db
        .update(users)
        .set({ forwardingAlias: "Izaak-7F3K" })
        .where(eq(users.id, user.id)),
    ).rejects.toThrow();
    await expect(
      ctx.db
        .update(users)
        .set({ forwardingAlias: "izaak-7f3k" })
        .where(eq(users.id, user.id)),
    ).resolves.toBeDefined();
  });

  it("is unique, and a user may have none", async () => {
    const a = await insertUser(ctx.db);
    const b = await insertUser(ctx.db);
    await ctx.db
      .update(users)
      .set({ forwardingAlias: "dup-alias" })
      .where(eq(users.id, a.id));
    await expect(
      ctx.db
        .update(users)
        .set({ forwardingAlias: "dup-alias" })
        .where(eq(users.id, b.id)),
    ).rejects.toThrow();
  });
});

describe("schema foreign keys", () => {
  const cases: [string, PgTable, PgTable][] = [
    ["shipments -> users", shipments, users],
    ["checkpoints -> shipments", checkpoints, shipments],
    ["inbound_emails -> users", inboundEmails, users],
    ["notification_settings -> users", notificationSettings, users],
    ["push_subscriptions -> users", pushSubscriptions, users],
  ];

  it.each(cases)("%s is a single cascading FK", (_name, table, target) => {
    const [fk, ...others] = getTableConfig(table).foreignKeys;
    expect(others).toHaveLength(0);
    expect(fk?.onDelete).toBe("cascade");
    expect(fk?.reference().foreignTable).toBe(target);
  });

  it("notifications cascade from both its user and its shipment", () => {
    const fks = getTableConfig(notifications).foreignKeys;
    expect(fks.map((fk) => fk.reference().foreignTable)).toEqual([
      users,
      shipments,
    ]);
    expect(fks.every((fk) => fk.onDelete === "cascade")).toBe(true);
  });
});
