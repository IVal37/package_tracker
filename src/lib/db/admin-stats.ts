// SYSTEM-SCOPE counts for the admin page. They look across every user, so
// ESLint lets only src/lib/admin import this module. Everything here returns
// counts and times: never a shipment, an email address or any text a user or
// an email supplied.
import {
  and,
  count,
  eq,
  gte,
  isNotNull,
  isNull,
  min,
  notInArray,
  sql,
} from "drizzle-orm";
import type { Db } from "./client";
import { inboundEmails, notifications, shipments, users } from "./schema";

export interface DayCount {
  /** UTC day, YYYY-MM-DD. */
  day: string;
  count: number;
}

/**
 * Provider trackers by the UTC day they were first used, since `since`. A
 * tracker shared by several users counts once. Based on the packages still
 * stored: a tracker whose every package was deleted is no longer counted.
 */
export async function trackersCreatedPerDay(
  db: Db,
  provider: string,
  since: Date,
): Promise<DayCount[]> {
  const first = db
    .select({
      trackerId: shipments.providerTrackerId,
      firstSeen: min(shipments.createdAt).as("first_seen"),
    })
    .from(shipments)
    .where(
      and(
        eq(shipments.provider, provider),
        isNotNull(shipments.providerTrackerId),
      ),
    )
    .groupBy(shipments.providerTrackerId)
    .as("first");

  const day = sql<string>`to_char(${first.firstSeen} at time zone 'UTC', 'YYYY-MM-DD')`;
  const rows = await db
    .select({ day, count: count() })
    .from(first)
    .where(gte(first.firstSeen, since))
    .groupBy(day)
    .orderBy(day);
  return rows.map((row) => ({ day: row.day, count: Number(row.count) }));
}

export interface AdminCounts {
  users: number;
  activeShipments: number;
  failedEmails: number;
  failedNotifications: number;
  oldestPendingEmail: Date | null;
  oldestPendingNotification: Date | null;
}

/** Totals for the admin page. Failures are counted since `failuresSince`. */
export async function adminCounts(
  db: Db,
  failuresSince: Date,
): Promise<AdminCounts> {
  const total = async (query: Promise<{ total: number }[]>) =>
    Number((await query)[0]?.total ?? 0);

  const [usersTotal, active, failedEmails, failedNotifications] =
    await Promise.all([
      total(db.select({ total: count() }).from(users)),
      total(
        db
          .select({ total: count() })
          .from(shipments)
          .where(
            and(
              isNull(shipments.archivedAt),
              notInArray(shipments.status, ["Delivered", "Expired"]),
            ),
          ),
      ),
      total(
        db
          .select({ total: count() })
          .from(inboundEmails)
          .where(
            and(
              eq(inboundEmails.parseStatus, "failed"),
              gte(inboundEmails.receivedAt, failuresSince),
            ),
          ),
      ),
      total(
        db
          .select({ total: count() })
          .from(notifications)
          .where(
            and(
              eq(notifications.status, "failed"),
              gte(notifications.createdAt, failuresSince),
            ),
          ),
      ),
    ]);

  const [email] = await db
    .select({ oldest: min(inboundEmails.receivedAt) })
    .from(inboundEmails)
    .where(eq(inboundEmails.parseStatus, "pending"));
  const [notification] = await db
    .select({ oldest: min(notifications.createdAt) })
    .from(notifications)
    .where(eq(notifications.status, "pending"));

  return {
    users: usersTotal,
    activeShipments: active,
    failedEmails,
    failedNotifications,
    oldestPendingEmail: email?.oldest ?? null,
    oldestPendingNotification: notification?.oldest ?? null,
  };
}
