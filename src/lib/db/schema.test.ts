// @vitest-environment node
import { eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  createTestDb,
  insertShipment,
  insertUser,
} from "../../../tests/db/pglite";
import { checkpoints, shipments, users } from "./schema";

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
