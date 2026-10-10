// "Download my data": one JSON document with everything stored about the
// signed-in user, in plain field names. Built only from userId-scoped queries.
import type { Db } from "@/lib/db/client";
import { loadUserData } from "@/lib/db/export";
import { formatAddress } from "@/lib/email/alias";

const iso = (date: Date | null) => (date ? date.toISOString() : null);

/** The stored email as it arrived, while it is still kept (30 days). */
function storedEmail(raw: string): unknown {
  try {
    return JSON.parse(raw);
  } catch {
    return raw;
  }
}

export async function buildUserExport(args: {
  db: Db;
  userId: string;
  inboundDomain: string;
  now: Date;
}) {
  const { db, userId, inboundDomain, now } = args;
  const data = await loadUserData(db, userId);

  const checkpointsByShipment = new Map<string, typeof data.checkpoints>();
  for (const checkpoint of data.checkpoints) {
    const list = checkpointsByShipment.get(checkpoint.shipmentId) ?? [];
    list.push(checkpoint);
    checkpointsByShipment.set(checkpoint.shipmentId, list);
  }

  return {
    format: "wayfind-export-1",
    exportedAt: now.toISOString(),
    account: data.account && {
      email: data.account.email,
      forwardingAddress: data.account.forwardingAlias
        ? formatAddress(data.account.forwardingAlias, inboundDomain)
        : null,
      createdAt: iso(data.account.createdAt),
    },
    packages: data.shipments.map((shipment) => ({
      id: shipment.id,
      trackingNumber: shipment.trackingNumber,
      nickname: shipment.nickname,
      courier: shipment.courier,
      status: shipment.status,
      estimatedDelivery: iso(shipment.eta),
      destination: shipment.destinationText,
      lastEventAt: iso(shipment.lastEventAt),
      archivedAt: iso(shipment.archivedAt),
      addedAt: iso(shipment.createdAt),
      trackingProvider: shipment.provider,
      events: (checkpointsByShipment.get(shipment.id) ?? []).map((event) => ({
        occurredAt: iso(event.occurredAt),
        status: event.status,
        message: event.message,
        location: event.locationText,
      })),
    })),
    orders: data.orders.map((order) => ({
      retailer: order.retailer,
      item: order.item,
      orderNumber: order.orderNumber,
      packageId: order.shipmentId,
      createdAt: iso(order.createdAt),
    })),
    forwardedEmails: data.emails.map((email) => ({
      receivedAt: iso(email.receivedAt),
      from: email.fromAddress,
      subject: email.subject,
      status: email.parseStatus,
      whatWeRead: email.extracted,
      email: storedEmail(email.raw),
    })),
    notificationSettings: data.notificationSettings && {
      push: {
        outForDelivery: data.notificationSettings.pushOutForDelivery,
        delivered: data.notificationSettings.pushDelivered,
        problem: data.notificationSettings.pushProblem,
        delay: data.notificationSettings.pushDelay,
      },
      email: {
        outForDelivery: data.notificationSettings.emailOutForDelivery,
        delivered: data.notificationSettings.emailDelivered,
        problem: data.notificationSettings.emailProblem,
        delay: data.notificationSettings.emailDelay,
      },
      quietHours: {
        enabled: data.notificationSettings.quietEnabled,
        startMinute: data.notificationSettings.quietStart,
        endMinute: data.notificationSettings.quietEnd,
        timeZone: data.notificationSettings.timeZone,
      },
    },
    alerts: data.notifications.map((alert) => ({
      packageId: alert.shipmentId,
      kind: alert.kind,
      status: alert.status,
      skipReason: alert.skipReason,
      sentByPush: alert.pushSent,
      sentByEmail: alert.emailSent,
      createdAt: iso(alert.createdAt),
      sentAt: iso(alert.sentAt),
    })),
    pushDevices: {
      count: data.devices.length,
      devices: data.devices.map((device) => ({
        addedAt: iso(device.createdAt),
        lastReachedAt: iso(device.lastSuccessAt),
      })),
    },
  };
}

export type UserExport = Awaited<ReturnType<typeof buildUserExport>>;
