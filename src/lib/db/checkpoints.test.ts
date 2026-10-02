// @vitest-environment node
import { eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { NormalizedEvent } from "@/lib/tracking/types";
import {
  createTestDb,
  insertShipment,
  insertUser,
} from "../../../tests/db/pglite";
import { insertCheckpoints } from "./checkpoints";
import { checkpoints } from "./schema";

let ctx: Awaited<ReturnType<typeof createTestDb>>;

beforeAll(async () => {
  ctx = await createTestDb();
});

afterAll(async () => {
  await ctx.client.close();
});

const event = (id: string, hour: number): NormalizedEvent => ({
  providerEventId: id,
  occurredAt: new Date(Date.UTC(2026, 0, 1, hour)),
  status: "InTransit",
  message: `event ${id}`,
  locationText: "MEMPHIS, TN",
  courierCode: "us-post",
  order: null,
});

async function newShipmentId() {
  const user = await insertUser(ctx.db);
  return (await insertShipment(ctx.db, user.id)).id;
}

async function countFor(shipmentId: string) {
  const rows = await ctx.db
    .select()
    .from(checkpoints)
    .where(eq(checkpoints.shipmentId, shipmentId));
  return rows.length;
}

describe("insertCheckpoints", () => {
  it("inserts new events and reports the count", async () => {
    const shipmentId = await newShipmentId();
    const added = await insertCheckpoints(ctx.db, shipmentId, [
      event("a", 1),
      event("b", 2),
    ]);
    expect(added).toBe(2);
    expect(await countFor(shipmentId)).toBe(2);
  });

  it("adds nothing when the same events are inserted twice", async () => {
    const shipmentId = await newShipmentId();
    const events = [event("a", 1), event("b", 2)];
    await insertCheckpoints(ctx.db, shipmentId, events);
    const again = await insertCheckpoints(ctx.db, shipmentId, events);
    expect(again).toBe(0);
    expect(await countFor(shipmentId)).toBe(2);
  });

  it("inserts only the new events from a mixed batch", async () => {
    const shipmentId = await newShipmentId();
    await insertCheckpoints(ctx.db, shipmentId, [event("a", 1), event("b", 2)]);
    const added = await insertCheckpoints(ctx.db, shipmentId, [
      event("b", 2),
      event("c", 3),
      event("d", 4),
    ]);
    expect(added).toBe(2);
    expect(await countFor(shipmentId)).toBe(4);
  });

  it("returns 0 for an empty batch without querying", async () => {
    const shipmentId = await newShipmentId();
    expect(await insertCheckpoints(ctx.db, shipmentId, [])).toBe(0);
  });

  it("treats the same event id on a different shipment as new", async () => {
    const first = await newShipmentId();
    const second = await newShipmentId();
    await insertCheckpoints(ctx.db, first, [event("a", 1)]);
    expect(await insertCheckpoints(ctx.db, second, [event("a", 1)])).toBe(1);
  });
});
