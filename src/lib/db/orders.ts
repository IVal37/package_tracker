// Orders from retailers, with or without a shipment yet. Every function takes
// userId and filters by it: another user's order is indistinguishable from a
// missing one.
import { and, desc, eq, isNull } from "drizzle-orm";
import type { Db } from "./client";
import { orders } from "./schema";
import { isUniqueViolation, isUuid } from "./shipments";

export type OrderRow = typeof orders.$inferSelect;

export interface NewOrder {
  retailer: string | null;
  retailerKey: string | null;
  item: string | null;
  orderNumber: string | null;
  sourceEmailId: string | null;
}

/** Orders still waiting for their shipping email (the "Ordered" section), newest first. */
export async function listOrderPlaceholders(
  db: Db,
  userId: string,
): Promise<OrderRow[]> {
  return db
    .select()
    .from(orders)
    .where(and(eq(orders.userId, userId), isNull(orders.shipmentId)))
    .orderBy(desc(orders.createdAt));
}

/** The order that produced this shipment, if it came from an email. */
export async function getOrderForShipment(
  db: Db,
  userId: string,
  shipmentId: string,
): Promise<OrderRow | null> {
  if (!isUuid(shipmentId)) return null;
  const [row] = await db
    .select()
    .from(orders)
    .where(and(eq(orders.userId, userId), eq(orders.shipmentId, shipmentId)));
  return row ?? null;
}

/** Removes a placeholder the user no longer wants. Shipped orders are not touched. */
export async function dismissOrder(
  db: Db,
  userId: string,
  orderId: string,
): Promise<boolean> {
  if (!isUuid(orderId)) return false;
  const deleted = await db
    .delete(orders)
    .where(
      and(
        eq(orders.id, orderId),
        eq(orders.userId, userId),
        isNull(orders.shipmentId),
      ),
    )
    .returning({ id: orders.id });
  return deleted.length > 0;
}

/** Every order of this user for the retailer and order number, shipped or not. */
export async function findOrdersByKey(
  db: Db,
  userId: string,
  retailerKey: string,
  orderNumber: string,
): Promise<OrderRow[]> {
  return db
    .select()
    .from(orders)
    .where(
      and(
        eq(orders.userId, userId),
        eq(orders.retailerKey, retailerKey),
        eq(orders.orderNumber, orderNumber),
      ),
    )
    .orderBy(orders.createdAt);
}

/** Creates an "Ordered" placeholder. Null if one already exists for that order. */
export async function createPlaceholder(
  db: Db,
  userId: string,
  order: NewOrder,
): Promise<string | null> {
  try {
    const [row] = await db
      .insert(orders)
      .values({ userId, ...order })
      .returning({ id: orders.id });
    return row?.id ?? null;
  } catch (error) {
    if (isUniqueViolation(error)) return null;
    throw error;
  }
}

/** Points a placeholder at its shipment. False if it was already attached or is not theirs. */
export async function attachShipment(
  db: Db,
  userId: string,
  orderId: string,
  shipmentId: string,
): Promise<boolean> {
  try {
    const updated = await db
      .update(orders)
      .set({ shipmentId })
      .where(
        and(
          eq(orders.id, orderId),
          eq(orders.userId, userId),
          isNull(orders.shipmentId),
        ),
      )
      .returning({ id: orders.id });
    return updated.length > 0;
  } catch (error) {
    // That shipment already has an order row.
    if (isUniqueViolation(error)) return false;
    throw error;
  }
}

/** Records the order behind a shipment that had no placeholder. Null if it already has one. */
export async function createShippedOrder(
  db: Db,
  userId: string,
  order: NewOrder & { shipmentId: string },
): Promise<string | null> {
  try {
    const [row] = await db
      .insert(orders)
      .values({ userId, ...order })
      .returning({ id: orders.id });
    return row?.id ?? null;
  } catch (error) {
    if (isUniqueViolation(error)) return null;
    throw error;
  }
}
