// Orders from retailers, with or without a shipment yet. Every function takes
// userId and filters by it: another user's order is indistinguishable from a
// missing one.
import { and, desc, eq, isNull } from "drizzle-orm";
import { shouldSetStage, type OrderStage } from "@/lib/email/order-stage";
import type { Db } from "./client";
import { orders } from "./schema";
import { isUuid, onUniqueViolation } from "./shipments";

export type OrderRow = typeof orders.$inferSelect;

export interface NewOrder {
  retailer: string | null;
  retailerKey: string | null;
  item: string | null;
  orderNumber: string | null;
  sourceEmailId: string | null;
}

/** What an email says about an order that has no shipment. */
export interface OrderStageUpdate {
  stage: OrderStage;
  /** The retailer's estimate in its own words, already cleaned. */
  etaText: string | null;
  /** When the email arrived (our clock, not the email's headers). */
  at: Date;
}

/** One of the user's orders that has no shipment yet. */
const placeholderOf = (userId: string, orderId: string) =>
  and(
    eq(orders.id, orderId),
    eq(orders.userId, userId),
    isNull(orders.shipmentId),
  );

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
    .where(placeholderOf(userId, orderId))
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

/**
 * Records an order: an "Ordered" placeholder, or with `shipmentId` the order
 * behind a shipment that had no placeholder. Null if that order or that
 * shipment already has one.
 */
export function createOrder(
  db: Db,
  userId: string,
  order: NewOrder & {
    shipmentId?: string;
    stage?: OrderStage;
    etaText?: string | null;
    stageAt?: Date;
  },
): Promise<string | null> {
  return onUniqueViolation(null, async () => {
    const [row] = await db
      .insert(orders)
      .values({ userId, ...order })
      .returning({ id: orders.id });
    return row?.id ?? null;
  });
}

/** Points a placeholder at its shipment. False if it was already attached or is not theirs. */
export function attachShipment(
  db: Db,
  userId: string,
  orderId: string,
  shipmentId: string,
): Promise<boolean> {
  // A violation means that shipment already has an order row.
  return onUniqueViolation(false, async () => {
    const updated = await db
      .update(orders)
      .set({ shipmentId })
      .where(placeholderOf(userId, orderId))
      .returning({ id: orders.id });
    return updated.length > 0;
  });
}

/**
 * Records what an email says about an order that has no shipment: creates the
 * order if there is none, or moves its stage on. The newest email wins by
 * arrival time (shouldSetStage); a late older one changes nothing. An order
 * that already has a shipment is the shipment's business and is left alone.
 * Returns what happened.
 */
export async function recordOrderStage(
  db: Db,
  userId: string,
  order: NewOrder & { retailerKey: string; orderNumber: string },
  update: OrderStageUpdate,
): Promise<"created" | "updated" | "unchanged"> {
  // A second email for the same order can land between the read and the
  // write; read again a couple of times before giving up.
  for (let attempt = 0; attempt < 3; attempt++) {
    const rows = await findOrdersByKey(
      db,
      userId,
      order.retailerKey,
      order.orderNumber,
    );
    if (rows.some((row) => row.shipmentId !== null)) return "unchanged";

    const current = rows[0];
    if (!current) {
      const id = await createOrder(db, userId, {
        ...order,
        stage: update.stage,
        etaText: update.etaText,
        stageAt: update.at,
      });
      if (id) return "created";
      continue;
    }
    if (!shouldSetStage(current, update.at)) return "unchanged";

    const updated = await db
      .update(orders)
      .set({
        stage: update.stage,
        etaText: update.etaText,
        stageAt: update.at,
        // Keep what the first email told us; fill in what it lacked.
        retailer: current.retailer ?? order.retailer,
        item: current.item ?? order.item,
      })
      .where(
        and(
          placeholderOf(userId, current.id),
          current.stageAt === null
            ? isNull(orders.stageAt)
            : eq(orders.stageAt, current.stageAt),
        ),
      )
      .returning({ id: orders.id });
    if (updated.length > 0) return "updated";
  }
  return "unchanged";
}
