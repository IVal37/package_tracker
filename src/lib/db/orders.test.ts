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
  createPlaceholder,
  createShippedOrder,
  dismissOrder,
  findOrdersByKey,
  getOrderForShipment,
  listOrderPlaceholders,
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
const order = (
  extra: Partial<Parameters<typeof createPlaceholder>[2]> = {},
) => ({
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
    const first = await createPlaceholder(
      ctx.db,
      user.id,
      order({ item: "First" }),
    );
    await new Promise((resolve) => setTimeout(resolve, 5));
    const second = await createPlaceholder(
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
    expect(await createPlaceholder(ctx.db, user.id, data)).not.toBeNull();
    expect(await createPlaceholder(ctx.db, user.id, data)).toBeNull();
    expect(await listOrderPlaceholders(ctx.db, user.id)).toHaveLength(1);
  });

  it("does not list shipped orders as placeholders", async () => {
    const user = await insertUser(ctx.db);
    const shipment = await insertShipment(ctx.db, user.id);
    await createShippedOrder(ctx.db, user.id, {
      ...order(),
      shipmentId: shipment.id,
    });
    expect(await listOrderPlaceholders(ctx.db, user.id)).toEqual([]);
  });

  it("never lists another user's placeholders", async () => {
    const a = await insertUser(ctx.db);
    const b = await insertUser(ctx.db);
    await createPlaceholder(ctx.db, a.id, order());
    expect(await listOrderPlaceholders(ctx.db, b.id)).toEqual([]);
    expect(await listOrderPlaceholders(ctx.db, a.id)).toHaveLength(1);
  });
});

describe("findOrdersByKey", () => {
  it("finds placeholders and shipped orders for the retailer and order number", async () => {
    const user = await insertUser(ctx.db);
    const shipment = await insertShipment(ctx.db, user.id);
    await createPlaceholder(ctx.db, user.id, order({ orderNumber: "K-1" }));
    await createShippedOrder(ctx.db, user.id, {
      ...order({ orderNumber: "K-1" }),
      shipmentId: shipment.id,
    });

    expect(
      await findOrdersByKey(ctx.db, user.id, "amazon", "K-1"),
    ).toHaveLength(2);
  });

  it("matches on both retailer and order number", async () => {
    const user = await insertUser(ctx.db);
    await createPlaceholder(
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
    await createPlaceholder(ctx.db, a.id, order({ orderNumber: "PRIV-1" }));
    expect(await findOrdersByKey(ctx.db, b.id, "amazon", "PRIV-1")).toEqual([]);
  });
});

describe("attachShipment", () => {
  it("points a placeholder at a shipment, once", async () => {
    const user = await insertUser(ctx.db);
    const shipment = await insertShipment(ctx.db, user.id);
    const other = await insertShipment(ctx.db, user.id);
    const id = (await createPlaceholder(ctx.db, user.id, order()))!;

    expect(await attachShipment(ctx.db, user.id, id, shipment.id)).toBe(true);
    expect(await attachShipment(ctx.db, user.id, id, other.id)).toBe(false);
    expect((await getOrderForShipment(ctx.db, user.id, shipment.id))?.id).toBe(
      id,
    );
  });

  it("refuses a shipment that already has an order row, without throwing", async () => {
    const user = await insertUser(ctx.db);
    const shipment = await insertShipment(ctx.db, user.id);
    await createShippedOrder(ctx.db, user.id, {
      ...order(),
      shipmentId: shipment.id,
    });
    const id = (await createPlaceholder(ctx.db, user.id, order()))!;
    expect(await attachShipment(ctx.db, user.id, id, shipment.id)).toBe(false);
  });

  it("cannot attach another user's placeholder", async () => {
    const owner = await insertUser(ctx.db);
    const intruder = await insertUser(ctx.db);
    const shipment = await insertShipment(ctx.db, intruder.id);
    const id = (await createPlaceholder(ctx.db, owner.id, order()))!;

    expect(await attachShipment(ctx.db, intruder.id, id, shipment.id)).toBe(
      false,
    );
    const [row] = await ctx.db.select().from(orders).where(eq(orders.id, id));
    expect(row?.shipmentId).toBeNull();
  });
});

describe("createShippedOrder", () => {
  it("returns null when the shipment already has an order row", async () => {
    const user = await insertUser(ctx.db);
    const shipment = await insertShipment(ctx.db, user.id);
    const data = { ...order(), shipmentId: shipment.id };
    expect(await createShippedOrder(ctx.db, user.id, data)).not.toBeNull();
    expect(await createShippedOrder(ctx.db, user.id, data)).toBeNull();
  });
});

describe("getOrderForShipment", () => {
  it("returns the order behind a shipment, only to its owner", async () => {
    const a = await insertUser(ctx.db);
    const b = await insertUser(ctx.db);
    const shipment = await insertShipment(ctx.db, a.id);
    await createShippedOrder(ctx.db, a.id, {
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
    const id = (await createPlaceholder(ctx.db, user.id, order()))!;
    expect(await dismissOrder(ctx.db, user.id, id)).toBe(true);
    expect(await listOrderPlaceholders(ctx.db, user.id)).toEqual([]);
  });

  it("cannot remove another user's placeholder, which looks exactly like a missing one", async () => {
    const owner = await insertUser(ctx.db);
    const intruder = await insertUser(ctx.db);
    const id = (await createPlaceholder(ctx.db, owner.id, order()))!;

    expect(await dismissOrder(ctx.db, intruder.id, id)).toBe(false);
    expect(await dismissOrder(ctx.db, intruder.id, NO_SUCH_ID)).toBe(false);
    expect(await listOrderPlaceholders(ctx.db, owner.id)).toHaveLength(1);
  });

  it("does not remove a shipped order", async () => {
    const user = await insertUser(ctx.db);
    const shipment = await insertShipment(ctx.db, user.id);
    const id = (await createShippedOrder(ctx.db, user.id, {
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
