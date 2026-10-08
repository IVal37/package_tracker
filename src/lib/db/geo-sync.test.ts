// @vitest-environment node
import { eq } from "drizzle-orm";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { createTestDb, insertUser } from "../../../tests/db/pglite";
import { findPendingPlaces, hasPlace, savePlace } from "./geo-sync";
import { checkpoints, places, shipments } from "./schema";

let ctx: Awaited<ReturnType<typeof createTestDb>>;

beforeAll(async () => {
  ctx = await createTestDb();
});

afterAll(async () => {
  await ctx.client.close();
});

// Each test starts from an empty world.
beforeEach(async () => {
  await ctx.db.delete(checkpoints);
  await ctx.db.delete(shipments);
  await ctx.db.delete(places);
});

let seq = 0;
async function addShipment(
  extra: Partial<typeof shipments.$inferInsert> = {},
  userId?: string,
) {
  const owner = userId ?? (await insertUser(ctx.db)).id;
  const [row] = await ctx.db
    .insert(shipments)
    .values({
      userId: owner,
      trackingNumber: `GS-${++seq}`,
      provider: "fake",
      ...extra,
    })
    .returning();
  if (!row) throw new Error("insert failed");
  return row;
}

async function addCheckpoint(shipmentId: string, locationText: string | null) {
  await ctx.db.insert(checkpoints).values({
    shipmentId,
    providerEventId: `evt-${++seq}`,
    occurredAt: new Date("2026-06-01T00:00:00Z"),
    status: "InTransit",
    locationText,
  });
}

const keys = (pending: { key: string }[]) => pending.map((p) => p.key).sort();

describe("findPendingPlaces", () => {
  it("returns checkpoint and destination places that are not cached", async () => {
    const s = await addShipment({ destinationText: "Portland, OR, US" });
    await addCheckpoint(s.id, "MEMPHIS, TN");

    const pending = await findPendingPlaces(ctx.db, 100);

    expect(keys(pending)).toEqual(["memphis, tn", "portland, or, us"]);
    expect(pending.find((p) => p.key === "memphis, tn")?.text).toBe(
      "MEMPHIS, TN",
    );
  });

  it("lists a place once however many checkpoints and users mention it", async () => {
    const a = await addShipment();
    const b = await addShipment();
    await addCheckpoint(a.id, "CHICAGO, IL");
    await addCheckpoint(a.id, "chicago,  il".replace(",  ", ", "));
    await addCheckpoint(b.id, "  Chicago, IL ");

    const pending = await findPendingPlaces(ctx.db, 100);

    expect(keys(pending)).toEqual(["chicago, il"]);
  });

  it("merges a destination with the same text as a checkpoint place", async () => {
    const s = await addShipment({ destinationText: "DENVER, CO" });
    await addCheckpoint(s.id, "Denver, CO");
    expect(keys(await findPendingPlaces(ctx.db, 100))).toEqual(["denver, co"]);
  });

  it("skips places already cached, including remembered misses", async () => {
    const s = await addShipment({ destinationText: "Portland, OR, US" });
    await addCheckpoint(s.id, "MEMPHIS, TN");
    await addCheckpoint(s.id, "ATLANTIS");
    await savePlace(
      ctx.db,
      "memphis, tn",
      { lat: 1, lng: 2, displayName: null },
      "fake",
    );
    await savePlace(ctx.db, "atlantis", null, "fake");

    expect(keys(await findPendingPlaces(ctx.db, 100))).toEqual([
      "portland, or, us",
    ]);
  });

  it("ignores blank and missing text", async () => {
    const s = await addShipment({ destinationText: "   " });
    await addCheckpoint(s.id, null);
    await addCheckpoint(s.id, "   ");
    expect(await findPendingPlaces(ctx.db, 100)).toEqual([]);
  });

  it("ignores archived shipments", async () => {
    const s = await addShipment({
      archivedAt: new Date("2026-06-01T00:00:00Z"),
      destinationText: "Portland, OR, US",
    });
    await addCheckpoint(s.id, "MEMPHIS, TN");
    expect(await findPendingPlaces(ctx.db, 100)).toEqual([]);
  });

  it("respects the limit", async () => {
    const s = await addShipment();
    for (const city of ["A", "B", "C", "D", "E"]) {
      await addCheckpoint(s.id, `${city} CITY`);
    }
    expect(await findPendingPlaces(ctx.db, 3)).toHaveLength(3);
  });

  it("never exposes anything but key and text", async () => {
    const s = await addShipment({
      nickname: "secret nickname",
      destinationText: "Portland, OR, US",
    });
    await addCheckpoint(s.id, "MEMPHIS, TN");

    for (const place of await findPendingPlaces(ctx.db, 100)) {
      expect(Object.keys(place).sort()).toEqual(["key", "text"]);
    }
  });
});

describe("hasPlace and savePlace", () => {
  it("caches a hit", async () => {
    expect(await hasPlace(ctx.db, "memphis, tn")).toBe(false);

    const written = await savePlace(
      ctx.db,
      "memphis, tn",
      { lat: 35.1, lng: -90.0, displayName: "Memphis" },
      "nominatim",
    );

    expect(written).toBe(true);
    expect(await hasPlace(ctx.db, "memphis, tn")).toBe(true);
    const [row] = await ctx.db
      .select()
      .from(places)
      .where(eq(places.queryKey, "memphis, tn"));
    expect(row).toMatchObject({
      lat: 35.1,
      lng: -90.0,
      displayName: "Memphis",
      geocoder: "nominatim",
    });
  });

  it("remembers a miss as a row with no coordinates", async () => {
    await savePlace(ctx.db, "atlantis", null, "fake");
    expect(await hasPlace(ctx.db, "atlantis")).toBe(true);
    const [row] = await ctx.db
      .select()
      .from(places)
      .where(eq(places.queryKey, "atlantis"));
    expect(row?.lat).toBeNull();
    expect(row?.lng).toBeNull();
  });

  it("is safe to call twice and keeps the first answer", async () => {
    await savePlace(ctx.db, "x", { lat: 1, lng: 1, displayName: null }, "fake");
    const second = await savePlace(
      ctx.db,
      "x",
      { lat: 9, lng: 9, displayName: null },
      "fake",
    );
    expect(second).toBe(false);
    const [row] = await ctx.db
      .select()
      .from(places)
      .where(eq(places.queryKey, "x"));
    expect(row?.lat).toBe(1);
  });
});
