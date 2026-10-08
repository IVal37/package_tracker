// @vitest-environment node
import { eq } from "drizzle-orm";
import { getTableConfig, type PgTable } from "drizzle-orm/pg-core";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  createTestDb,
  insertShipment,
  insertUser,
} from "../../../tests/db/pglite";
import { checkpoints, inboundEmails, places, shipments, users } from "./schema";

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
      "places",
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
    const [archive, sync] = result.rows;
    expect(archive?.indexname).toBe("shipments_archive_due_idx");
    expect(archive?.indexdef).toMatch(/WHERE .*Delivered/);
    expect(sync?.indexname).toBe("shipments_sync_due_idx");
    expect(sync?.indexdef).toMatch(/WHERE .*archived_at IS NULL/);
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

describe("schema foreign keys", () => {
  const cases: [string, PgTable, PgTable][] = [
    ["shipments -> users", shipments, users],
    ["checkpoints -> shipments", checkpoints, shipments],
    ["inbound_emails -> users", inboundEmails, users],
  ];

  it.each(cases)("%s is a single cascading FK", (_name, table, target) => {
    const [fk, ...others] = getTableConfig(table).foreignKeys;
    expect(others).toHaveLength(0);
    expect(fk?.onDelete).toBe("cascade");
    expect(fk?.reference().foreignTable).toBe(target);
  });
});
