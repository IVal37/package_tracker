// @vitest-environment node
import { eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  createTestDb,
  insertShipment,
  insertUser,
} from "../../../tests/db/pglite";
import {
  attachShipment,
  createOrder,
  dismissOrder,
  findOrdersByKey,
  getOrderForShipment,
  listOrderPlaceholders,
  recordOrderStage,
} from "./orders";
import { orders } from "./schema";

let ctx: Awaited<ReturnType<typeof createTestDb>>;

beforeAll(async () => {
  ctx = await createTestDb();
});

afterAll(async () => {
  await ctx.client.close();
});

const NO_SUCH_ID = "99999999-9999-4999-8999-999999999999";
const order = (extra: Partial<Parameters<typeof createOrder>[2]> = {}) => ({
  retailer: "Amazon",
  retailerKey: "amazon",
  item: "Socks",
  orderNumber: `ORD-${Math.random().toString(36).slice(2)}`,
  sourceEmailId: null,
  ...extra,
});

describe("placeholders", () => {
  it("creates one and lists it for its owner, newest first", async () => {
    const user = await insertUser(ctx.db);
    const first = await createOrder(ctx.db, user.id, order({ item: "First" }));
    await new Promise((resolve) => setTimeout(resolve, 5));
    const second = await createOrder(
      ctx.db,
      user.id,
      order({ item: "Second" }),
    );

    const listed = await listOrderPlaceholders(ctx.db, user.id);
    expect(listed.map((o) => o.id)).toEqual([second, first]);
  });

  it("refuses a second placeholder for the same order and returns null", async () => {
    const user = await insertUser(ctx.db);
    const data = order({ orderNumber: "SAME-1" });
    expect(await createOrder(ctx.db, user.id, data)).not.toBeNull();
    expect(await createOrder(ctx.db, user.id, data)).toBeNull();
    expect(await listOrderPlaceholders(ctx.db, user.id)).toHaveLength(1);
  });

  it("does not list shipped orders as placeholders", async () => {
    const user = await insertUser(ctx.db);
    const shipment = await insertShipment(ctx.db, user.id);
    await createOrder(ctx.db, user.id, {
      ...order(),
      shipmentId: shipment.id,
    });
    expect(await listOrderPlaceholders(ctx.db, user.id)).toEqual([]);
  });

  it("never lists another user's placeholders", async () => {
    const a = await insertUser(ctx.db);
    const b = await insertUser(ctx.db);
    await createOrder(ctx.db, a.id, order());
    expect(await listOrderPlaceholders(ctx.db, b.id)).toEqual([]);
    expect(await listOrderPlaceholders(ctx.db, a.id)).toHaveLength(1);
  });
});

describe("findOrdersByKey", () => {
  it("finds placeholders and shipped orders for the retailer and order number", async () => {
    const user = await insertUser(ctx.db);
    const shipment = await insertShipment(ctx.db, user.id);
    await createOrder(ctx.db, user.id, order({ orderNumber: "K-1" }));
    await createOrder(ctx.db, user.id, {
      ...order({ orderNumber: "K-1" }),
      shipmentId: shipment.id,
    });

    expect(
      await findOrdersByKey(ctx.db, user.id, "amazon", "K-1"),
    ).toHaveLength(2);
  });

  it("matches on both retailer and order number", async () => {
    const user = await insertUser(ctx.db);
    await createOrder(
      ctx.db,
      user.id,
      order({ retailerKey: "storeone", orderNumber: "#1001" }),
    );
    expect(
      await findOrdersByKey(ctx.db, user.id, "storeone", "#1001"),
    ).toHaveLength(1);
    expect(
      await findOrdersByKey(ctx.db, user.id, "storetwo", "#1001"),
    ).toHaveLength(0);
    expect(
      await findOrdersByKey(ctx.db, user.id, "storeone", "#1002"),
    ).toHaveLength(0);
  });

  it("never returns another user's order", async () => {
    const a = await insertUser(ctx.db);
    const b = await insertUser(ctx.db);
    await createOrder(ctx.db, a.id, order({ orderNumber: "PRIV-1" }));
    expect(await findOrdersByKey(ctx.db, b.id, "amazon", "PRIV-1")).toEqual([]);
  });
});

describe("attachShipment", () => {
  it("points a placeholder at a shipment, once", async () => {
    const user = await insertUser(ctx.db);
    const shipment = await insertShipment(ctx.db, user.id);
    const other = await insertShipment(ctx.db, user.id);
    const id = (await createOrder(ctx.db, user.id, order()))!;

    expect(await attachShipment(ctx.db, user.id, id, shipment.id)).toBe(true);
    expect(await attachShipment(ctx.db, user.id, id, other.id)).toBe(false);
    expect((await getOrderForShipment(ctx.db, user.id, shipment.id))?.id).toBe(
      id,
    );
  });

  it("refuses a shipment that already has an order row, without throwing", async () => {
    const user = await insertUser(ctx.db);
    const shipment = await insertShipment(ctx.db, user.id);
    await createOrder(ctx.db, user.id, {
      ...order(),
      shipmentId: shipment.id,
    });
    const id = (await createOrder(ctx.db, user.id, order()))!;
    expect(await attachShipment(ctx.db, user.id, id, shipment.id)).toBe(false);
  });

  it("cannot attach another user's placeholder", async () => {
    const owner = await insertUser(ctx.db);
    const intruder = await insertUser(ctx.db);
    const shipment = await insertShipment(ctx.db, intruder.id);
    const id = (await createOrder(ctx.db, owner.id, order()))!;

    expect(await attachShipment(ctx.db, intruder.id, id, shipment.id)).toBe(
      false,
    );
    const [row] = await ctx.db.select().from(orders).where(eq(orders.id, id));
    expect(row?.shipmentId).toBeNull();
  });
});

describe("createOrder with a shipment", () => {
  it("returns null when the shipment already has an order row", async () => {
    const user = await insertUser(ctx.db);
    const shipment = await insertShipment(ctx.db, user.id);
    const data = { ...order(), shipmentId: shipment.id };
    expect(await createOrder(ctx.db, user.id, data)).not.toBeNull();
    expect(await createOrder(ctx.db, user.id, data)).toBeNull();
  });
});

describe("getOrderForShipment", () => {
  it("returns the order behind a shipment, only to its owner", async () => {
    const a = await insertUser(ctx.db);
    const b = await insertUser(ctx.db);
    const shipment = await insertShipment(ctx.db, a.id);
    await createOrder(ctx.db, a.id, {
      ...order({ retailer: "Target" }),
      shipmentId: shipment.id,
    });

    expect(
      (await getOrderForShipment(ctx.db, a.id, shipment.id))?.retailer,
    ).toBe("Target");
    expect(await getOrderForShipment(ctx.db, b.id, shipment.id)).toBeNull();
  });

  it("returns null for a shipment without an order and for a malformed id", async () => {
    const user = await insertUser(ctx.db);
    const shipment = await insertShipment(ctx.db, user.id);
    expect(await getOrderForShipment(ctx.db, user.id, shipment.id)).toBeNull();
    expect(await getOrderForShipment(ctx.db, user.id, "not-a-uuid")).toBeNull();
    expect(await getOrderForShipment(ctx.db, user.id, NO_SUCH_ID)).toBeNull();
  });
});

describe("dismissOrder", () => {
  it("removes the user's own placeholder", async () => {
    const user = await insertUser(ctx.db);
    const id = (await createOrder(ctx.db, user.id, order()))!;
    expect(await dismissOrder(ctx.db, user.id, id)).toBe(true);
    expect(await listOrderPlaceholders(ctx.db, user.id)).toEqual([]);
  });

  it("cannot remove another user's placeholder, which looks exactly like a missing one", async () => {
    const owner = await insertUser(ctx.db);
    const intruder = await insertUser(ctx.db);
    const id = (await createOrder(ctx.db, owner.id, order()))!;

    expect(await dismissOrder(ctx.db, intruder.id, id)).toBe(false);
    expect(await dismissOrder(ctx.db, intruder.id, NO_SUCH_ID)).toBe(false);
    expect(await listOrderPlaceholders(ctx.db, owner.id)).toHaveLength(1);
  });

  it("does not remove a shipped order", async () => {
    const user = await insertUser(ctx.db);
    const shipment = await insertShipment(ctx.db, user.id);
    const id = (await createOrder(ctx.db, user.id, {
      ...order(),
      shipmentId: shipment.id,
    }))!;
    expect(await dismissOrder(ctx.db, user.id, id)).toBe(false);
    expect(
      await getOrderForShipment(ctx.db, user.id, shipment.id),
    ).not.toBeNull();
  });

  it("returns false for a malformed id instead of throwing", async () => {
    const user = await insertUser(ctx.db);
    expect(await dismissOrder(ctx.db, user.id, "not-a-uuid")).toBe(false);
    expect(await dismissOrder(ctx.db, user.id, "")).toBe(false);
  });
});

describe("database errors that are not duplicates", () => {
  // A foreign-key failure is a real fault, not "already exists": it must reach
  // the caller (the job retries) instead of looking like a skipped duplicate.
  it("createOrder rethrows for a user that does not exist", async () => {
    await expect(createOrder(ctx.db, NO_SUCH_ID, order())).rejects.toThrow();
  });

  it("attachShipment rethrows for a shipment that does not exist", async () => {
    const user = await insertUser(ctx.db);
    const id = (await createOrder(ctx.db, user.id, order()))!;
    await expect(
      attachShipment(ctx.db, user.id, id, NO_SUCH_ID),
    ).rejects.toThrow();
    // The placeholder is untouched.
    expect(await listOrderPlaceholders(ctx.db, user.id)).toHaveLength(1);
  });

  it("createOrder with a shipment rethrows for a shipment that does not exist", async () => {
    const user = await insertUser(ctx.db);
    await expect(
      createOrder(ctx.db, user.id, {
        ...order(),
        shipmentId: NO_SUCH_ID,
      }),
    ).rejects.toThrow();
  });
});

describe("recordOrderStage", () => {
  const at = (minutes: number) =>
    new Date(Date.UTC(2026, 10, 7, 12, minutes, 0));
  const keyed = (orderNumber: string, extra = {}) => ({
    ...order({ orderNumber, ...extra }),
    retailerKey: "amazon",
    orderNumber,
  });

  it("creates an order from a shipping email that has no shipment", async () => {
    const user = await insertUser(ctx.db);
    const result = await recordOrderStage(ctx.db, user.id, keyed("112-1"), {
      stage: "shipped",
      etaText: "Arriving tomorrow",
      at: at(0),
    });
    expect(result).toBe("created");

    const [row] = await listOrderPlaceholders(ctx.db, user.id);
    expect(row).toMatchObject({
      stage: "shipped",
      etaText: "Arriving tomorrow",
      shipmentId: null,
    });
    expect(row?.stageAt).toEqual(at(0));
  });

  it("moves an existing placeholder on, keeping what the first email said", async () => {
    const user = await insertUser(ctx.db);
    await createOrder(ctx.db, user.id, keyed("112-2", { item: "Socks" }));

    const result = await recordOrderStage(
      ctx.db,
      user.id,
      keyed("112-2", { item: null, retailer: null }),
      { stage: "shipped", etaText: "Arriving tomorrow", at: at(0) },
    );

    expect(result).toBe("updated");
    const rows = await listOrderPlaceholders(ctx.db, user.id);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      stage: "shipped",
      item: "Socks",
      retailer: "Amazon",
    });
  });

  it("lets a newer email replace an older one, and ignores a late older one", async () => {
    const user = await insertUser(ctx.db);
    const data = keyed("112-3");
    await recordOrderStage(ctx.db, user.id, data, {
      stage: "shipped",
      etaText: "Arriving tomorrow",
      at: at(10),
    });

    expect(
      await recordOrderStage(ctx.db, user.id, data, {
        stage: "delivered",
        etaText: null,
        at: at(20),
      }),
    ).toBe("updated");
    expect(
      await recordOrderStage(ctx.db, user.id, data, {
        stage: "shipped",
        etaText: "Arriving Friday",
        at: at(5),
      }),
    ).toBe("unchanged");
    expect(
      await recordOrderStage(ctx.db, user.id, data, {
        stage: "shipped",
        etaText: "Arriving Friday",
        at: at(20),
      }),
    ).toBe("unchanged");

    const [row] = await listOrderPlaceholders(ctx.db, user.id);
    expect(row).toMatchObject({ stage: "delivered", etaText: null });
  });

  it("leaves an order that already has a shipment alone", async () => {
    const user = await insertUser(ctx.db);
    const shipment = await insertShipment(ctx.db, user.id);
    await createOrder(ctx.db, user.id, {
      ...keyed("112-4"),
      shipmentId: shipment.id,
    });

    const result = await recordOrderStage(ctx.db, user.id, keyed("112-4"), {
      stage: "delivered",
      etaText: null,
      at: at(0),
    });

    expect(result).toBe("unchanged");
    expect(await listOrderPlaceholders(ctx.db, user.id)).toEqual([]);
    const [row] = await findOrdersByKey(ctx.db, user.id, "amazon", "112-4");
    expect(row?.stage).toBe("ordered");
  });

  it("never touches another user's order of the same number", async () => {
    const owner = await insertUser(ctx.db);
    const other = await insertUser(ctx.db);
    await createOrder(ctx.db, owner.id, keyed("112-5"));

    await recordOrderStage(ctx.db, other.id, keyed("112-5"), {
      stage: "shipped",
      etaText: null,
      at: at(0),
    });

    const [mine] = await listOrderPlaceholders(ctx.db, owner.id);
    expect(mine?.stage).toBe("ordered");
    expect(await listOrderPlaceholders(ctx.db, other.id)).toHaveLength(1);
  });

  it("refuses a stage the database does not know", async () => {
    const user = await insertUser(ctx.db);
    await expect(
      ctx.db.insert(orders).values({
        userId: user.id,
        stage: "lost" as unknown as "shipped",
      }),
    ).rejects.toThrow();
  });
});
