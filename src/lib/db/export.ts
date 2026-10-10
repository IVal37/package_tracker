// Everything stored about one user, for "Download my data". Every query takes
// the userId and filters by it (checkpoints through their shipment), so the
// export can hold nothing of anyone else's.
import { asc, eq, inArray } from "drizzle-orm";
import type { Db } from "./client";
import {
  checkpoints,
  inboundEmails,
  notificationSettings,
  notifications,
  orders,
  pushSubscriptions,
  shipments,
  users,
} from "./schema";

export interface UserDataRows {
  account: {
    email: string;
    forwardingAlias: string | null;
    createdAt: Date;
  } | null;
  shipments: (typeof shipments.$inferSelect)[];
  checkpoints: (typeof checkpoints.$inferSelect)[];
  orders: (typeof orders.$inferSelect)[];
  emails: (typeof inboundEmails.$inferSelect)[];
  notificationSettings: typeof notificationSettings.$inferSelect | null;
  notifications: (typeof notifications.$inferSelect)[];
  /** Devices: when added and last reached. Never the endpoint or keys. */
  devices: { createdAt: Date; lastSuccessAt: Date | null }[];
}

export async function loadUserData(
  db: Db,
  userId: string,
): Promise<UserDataRows> {
  const [account] = await db
    .select({
      email: users.email,
      forwardingAlias: users.forwardingAlias,
      createdAt: users.createdAt,
    })
    .from(users)
    .where(eq(users.id, userId));

  const ownShipments = await db
    .select()
    .from(shipments)
    .where(eq(shipments.userId, userId))
    .orderBy(asc(shipments.createdAt));
  const ids = ownShipments.map((row) => row.id);

  const [ownCheckpoints, ownOrders, emails, settings, alerts, devices] =
    await Promise.all([
      ids.length === 0
        ? Promise.resolve([])
        : db
            .select()
            .from(checkpoints)
            .where(inArray(checkpoints.shipmentId, ids))
            .orderBy(asc(checkpoints.occurredAt)),
      db
        .select()
        .from(orders)
        .where(eq(orders.userId, userId))
        .orderBy(asc(orders.createdAt)),
      db
        .select()
        .from(inboundEmails)
        .where(eq(inboundEmails.userId, userId))
        .orderBy(asc(inboundEmails.receivedAt)),
      db
        .select()
        .from(notificationSettings)
        .where(eq(notificationSettings.userId, userId)),
      db
        .select()
        .from(notifications)
        .where(eq(notifications.userId, userId))
        .orderBy(asc(notifications.createdAt)),
      db
        .select({
          createdAt: pushSubscriptions.createdAt,
          lastSuccessAt: pushSubscriptions.lastSuccessAt,
        })
        .from(pushSubscriptions)
        .where(eq(pushSubscriptions.userId, userId))
        .orderBy(asc(pushSubscriptions.createdAt)),
    ]);

  return {
    account: account ?? null,
    shipments: ownShipments,
    checkpoints: ownCheckpoints,
    orders: ownOrders,
    emails,
    notificationSettings: settings[0] ?? null,
    notifications: alerts,
    devices,
  };
}
