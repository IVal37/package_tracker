// A user with a row in every table that holds user data, for the export and
// account-deletion tests. Each value names its owner, so a test can check
// that nothing of another user's leaks in.
import * as schema from "@/lib/db/schema";
import type { createTestDb } from "./pglite";

type TestDb = Awaited<ReturnType<typeof createTestDb>>["db"];

export async function seedFullUser(
  db: TestDb,
  label: string,
  options: { trackerId?: string } = {},
) {
  const [user] = await db
    .insert(schema.users)
    .values({
      email: `${label}@example.test`,
      forwardingAlias: `${label}-alias`,
    })
    .returning();
  const userId = user!.id;

  const [shipment] = await db
    .insert(schema.shipments)
    .values({
      userId,
      trackingNumber: `${label.toUpperCase()}TRACK1`,
      nickname: `${label} boots`,
      provider: "fake",
      providerTrackerId: options.trackerId ?? `fake:${label}-tracker`,
      destinationText: `${label} town`,
    })
    .returning();
  const shipmentId = shipment!.id;

  await db.insert(schema.checkpoints).values({
    shipmentId,
    providerEventId: `${label}-event`,
    occurredAt: new Date("2026-10-01T10:00:00Z"),
    status: "InTransit",
    message: `${label} departed`,
    locationText: `${label} hub`,
  });
  const [email] = await db
    .insert(schema.inboundEmails)
    .values({
      userId,
      raw: JSON.stringify({
        subject: `${label} shipped`,
        text: `${label} body`,
      }),
      fromAddress: `shop-${label}@example.test`,
      subject: `${label} shipped`,
      parseStatus: "parsed",
      extracted: { retailer: `${label} shop` },
    })
    .returning();
  await db.insert(schema.orders).values({
    userId,
    retailer: `${label} shop`,
    item: `${label} item`,
    orderNumber: `${label}-1001`,
    shipmentId,
    sourceEmailId: email!.id,
  });
  await db.insert(schema.notifications).values({
    userId,
    shipmentId,
    kind: "delivered",
    dedupeKey: `${label}-key`,
    status: "sent",
  });
  await db.insert(schema.notificationSettings).values({
    userId,
    timeZone: "Europe/Paris",
  });
  await db.insert(schema.pushSubscriptions).values({
    userId,
    endpoint: `https://fcm.googleapis.com/${label}`,
    p256dh: `${label}-p256dh`,
    auth: `${label}-auth`,
  });

  return { userId, shipmentId };
}
