// @vitest-environment node
import { eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createTestDb, insertUser } from "../../../tests/db/pglite";
import type {
  NormalizedEvent,
  NormalizedShipment,
  Status,
} from "@/lib/tracking";
import { notifications, shipments } from "./schema";
import { applyTrackerUpdate } from "./tracker-sync";

// Alerts are recorded by applyTrackerUpdate, in the same transaction as the
// change that earned them. These tests check "exactly once per event".

let ctx: Awaited<ReturnType<typeof createTestDb>>;

beforeAll(async () => {
  ctx = await createTestDb();
});

afterAll(async () => {
  await ctx.client.close();
});

const NOW = new Date("2026-06-20T12:00:00Z");
const hoursAgo = (hours: number) => new Date(NOW.getTime() - hours * 3_600_000);

let seq = 0;
const unique = (prefix: string) => `${prefix}-${++seq}`;

async function addShipment(
  overrides: Partial<typeof shipments.$inferInsert> & { userId: string },
) {
  const [row] = await ctx.db
    .insert(shipments)
    .values({
      trackingNumber: unique("TN"),
      provider: "fake",
      providerTrackerId: unique("tracker"),
      status: "InTransit",
      ...overrides,
    })
    .returning();
  if (!row) throw new Error("insert failed");
  return row;
}

const alertsOf = (shipmentId: string) =>
  ctx.db
    .select()
    .from(notifications)
    .where(eq(notifications.shipmentId, shipmentId));

const reload = async (id: string) => {
  const [row] = await ctx.db
    .select()
    .from(shipments)
    .where(eq(shipments.id, id));
  if (!row) throw new Error("missing");
  return row;
};

const event = (
  id: string,
  occurredAt: Date,
  status: Status,
): NormalizedEvent => ({
  providerEventId: id,
  occurredAt,
  status,
  message: null,
  locationText: null,
  courierCode: null,
  order: null,
});

const update = (
  trackerId: string,
  status: Status,
  events: NormalizedEvent[],
  eta: Date | null = null,
): NormalizedShipment => ({
  providerTrackerId: trackerId,
  trackingNumber: "IGNORED",
  courier: null,
  status,
  eta,
  lastEventAt: events[0]?.occurredAt ?? null,
  destination: null,
  events,
});

const apply = (payload: NormalizedShipment, now = NOW) =>
  applyTrackerUpdate(ctx.db, "fake", payload, now);

describe("alerts for a status change", () => {
  it("records an out_for_delivery alert for the owner, pending, and returns its id", async () => {
    const user = await insertUser(ctx.db);
    const row = await addShipment({ userId: user.id });

    const result = await apply(
      update(row.providerTrackerId!, "OutForDelivery", [
        event("e1", hoursAgo(1), "OutForDelivery"),
      ]),
    );

    const rows = await alertsOf(row.id);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      userId: user.id,
      shipmentId: row.id,
      kind: "out_for_delivery",
      status: "pending",
      dedupeKey: `OutForDelivery:${hoursAgo(1).toISOString()}`,
    });
    expect(result.notificationIds).toEqual([rows[0]!.id]);
  });

  it.each<[Status, string]>([
    ["Delivered", "delivered"],
    ["AvailableForPickup", "delivered"],
    ["Exception", "problem"],
    ["AttemptFail", "problem"],
  ])("records %s as a %s alert", async (status, kind) => {
    const user = await insertUser(ctx.db);
    const row = await addShipment({
      userId: user.id,
      status: "OutForDelivery",
    });

    await apply(
      update(row.providerTrackerId!, status, [
        event("e1", hoursAgo(1), status),
      ]),
    );

    const rows = await alertsOf(row.id);
    expect(rows.map((r) => r.kind)).toEqual([kind]);
  });

  it("records nothing for statuses that do not alert", async () => {
    const user = await insertUser(ctx.db);
    const row = await addShipment({ userId: user.id, status: "Pending" });

    const first = await apply(
      update(row.providerTrackerId!, "InfoReceived", [
        event("e1", hoursAgo(3), "InfoReceived"),
      ]),
    );
    const second = await apply(
      update(row.providerTrackerId!, "InTransit", [
        event("e2", hoursAgo(2), "InTransit"),
      ]),
    );

    expect(first.notificationIds).toEqual([]);
    expect(second.notificationIds).toEqual([]);
    expect(await alertsOf(row.id)).toHaveLength(0);
  });

  it("records nothing when the status does not change", async () => {
    const user = await insertUser(ctx.db);
    const row = await addShipment({
      userId: user.id,
      status: "OutForDelivery",
    });

    const result = await apply(
      update(row.providerTrackerId!, "OutForDelivery", [
        event("e1", hoursAgo(1), "OutForDelivery"),
      ]),
    );

    expect(result.notificationIds).toEqual([]);
    expect(await alertsOf(row.id)).toHaveLength(0);
  });
});

describe("exactly once per event", () => {
  it("records one alert when the same webhook is delivered twice", async () => {
    const user = await insertUser(ctx.db);
    const row = await addShipment({ userId: user.id });
    const payload = update(row.providerTrackerId!, "Delivered", [
      event("e1", hoursAgo(1), "Delivered"),
    ]);

    const first = await apply(payload);
    const second = await apply(payload);

    expect(first.notificationIds).toHaveLength(1);
    expect(second.notificationIds).toEqual([]);
    expect(await alertsOf(row.id)).toHaveLength(1);
  });

  it("records nothing when a re-fetch later reports the state a webhook already applied", async () => {
    const user = await insertUser(ctx.db);
    const row = await addShipment({ userId: user.id });
    const payload = update(row.providerTrackerId!, "OutForDelivery", [
      event("e1", hoursAgo(1), "OutForDelivery"),
    ]);

    await apply(payload);
    const refetch = await apply(payload, new Date(NOW.getTime() + 86_400_000));

    expect(refetch.notificationIds).toEqual([]);
    expect(await alertsOf(row.id)).toHaveLength(1);
  });

  it("records one alert when two identical updates run at the same time", async () => {
    const user = await insertUser(ctx.db);
    const row = await addShipment({ userId: user.id });
    const payload = update(row.providerTrackerId!, "Delivered", [
      event("e1", hoursAgo(1), "Delivered"),
    ]);

    const [a, b] = await Promise.all([apply(payload), apply(payload)]);

    expect(a.notificationIds.length + b.notificationIds.length).toBe(1);
    expect(await alertsOf(row.id)).toHaveLength(1);
  });

  it("records nothing for a late older event, which changes neither status nor ETA", async () => {
    const user = await insertUser(ctx.db);
    const row = await addShipment({ userId: user.id });
    const tracker = row.providerTrackerId!;

    await apply(
      update(tracker, "OutForDelivery", [
        event("new", hoursAgo(1), "OutForDelivery"),
      ]),
    );
    const late = await apply(
      update(tracker, "Exception", [event("old", hoursAgo(9), "Exception")]),
    );

    expect(late.notificationIds).toEqual([]);
    expect((await reload(row.id)).status).toBe("OutForDelivery");
    expect((await alertsOf(row.id)).map((r) => r.kind)).toEqual([
      "out_for_delivery",
    ]);
  });

  it("alerts again for a genuinely new event: out for delivery, attempt failed, out for delivery", async () => {
    const user = await insertUser(ctx.db);
    const row = await addShipment({ userId: user.id });
    const tracker = row.providerTrackerId!;

    await apply(
      update(tracker, "OutForDelivery", [
        event("e1", hoursAgo(30), "OutForDelivery"),
      ]),
    );
    await apply(
      update(tracker, "AttemptFail", [
        event("e2", hoursAgo(20), "AttemptFail"),
      ]),
    );
    await apply(
      update(tracker, "OutForDelivery", [
        event("e3", hoursAgo(6), "OutForDelivery"),
      ]),
    );

    expect((await alertsOf(row.id)).map((r) => r.kind).sort()).toEqual([
      "out_for_delivery",
      "out_for_delivery",
      "problem",
    ]);
  });
});

describe("a tracker shared by several users", () => {
  it("gives each user their own single alert", async () => {
    const a = await insertUser(ctx.db);
    const b = await insertUser(ctx.db);
    const tracker = unique("shared");
    const forA = await addShipment({
      userId: a.id,
      providerTrackerId: tracker,
    });
    const forB = await addShipment({
      userId: b.id,
      providerTrackerId: tracker,
    });
    const payload = update(tracker, "OutForDelivery", [
      event("e1", hoursAgo(1), "OutForDelivery"),
    ]);

    const result = await apply(payload);
    await apply(payload);

    expect(result.notificationIds).toHaveLength(2);
    const [alertA] = await alertsOf(forA.id);
    const [alertB] = await alertsOf(forB.id);
    expect(alertA?.userId).toBe(a.id);
    expect(alertB?.userId).toBe(b.id);
    expect(await alertsOf(forA.id)).toHaveLength(1);
    expect(await alertsOf(forB.id)).toHaveLength(1);
  });
});

describe("shipments that never alert", () => {
  it("stays silent for an archived shipment, though its status still updates", async () => {
    const user = await insertUser(ctx.db);
    const row = await addShipment({
      userId: user.id,
      archivedAt: hoursAgo(48),
    });

    const result = await apply(
      update(row.providerTrackerId!, "OutForDelivery", [
        event("e1", hoursAgo(1), "OutForDelivery"),
      ]),
    );

    expect(result.notificationIds).toEqual([]);
    expect(await alertsOf(row.id)).toHaveLength(0);
    expect((await reload(row.id)).status).toBe("OutForDelivery");
  });

  it("records nothing for an unknown tracker", async () => {
    const result = await apply(
      update("no-such-tracker", "Delivered", [
        event("e1", hoursAgo(1), "Delivered"),
      ]),
    );
    expect(result.notificationIds).toEqual([]);
  });
});

describe("delay alerts", () => {
  const eta = (iso: string) => new Date(iso);

  it("records a delay alert when the ETA moves to a later day", async () => {
    const user = await insertUser(ctx.db);
    const row = await addShipment({
      userId: user.id,
      eta: eta("2026-06-22T18:00:00Z"),
    });

    const result = await apply(
      update(
        row.providerTrackerId!,
        "InTransit",
        [event("e1", hoursAgo(1), "InTransit")],
        eta("2026-06-25T18:00:00Z"),
      ),
    );

    const rows = await alertsOf(row.id);
    expect(rows.map((r) => [r.kind, r.dedupeKey])).toEqual([
      ["delay", "eta:2026-06-25"],
    ]);
    expect(result.notificationIds).toEqual([rows[0]!.id]);
  });

  it("alerts once for that new ETA however often it is reported", async () => {
    const user = await insertUser(ctx.db);
    const row = await addShipment({
      userId: user.id,
      eta: eta("2026-06-22T18:00:00Z"),
    });
    const payload = update(
      row.providerTrackerId!,
      "InTransit",
      [event("e1", hoursAgo(1), "InTransit")],
      eta("2026-06-25T18:00:00Z"),
    );

    await apply(payload);
    await apply(payload);

    expect(await alertsOf(row.id)).toHaveLength(1);
  });

  it("records nothing when the ETA moves earlier, stays on the same day, or first appears", async () => {
    const user = await insertUser(ctx.db);
    const row = await addShipment({
      userId: user.id,
      eta: eta("2026-06-25T18:00:00Z"),
    });
    const tracker = row.providerTrackerId!;

    await apply(
      update(
        tracker,
        "InTransit",
        [event("e1", hoursAgo(5), "InTransit")],
        eta("2026-06-23T18:00:00Z"),
      ),
    );
    await apply(
      update(
        tracker,
        "InTransit",
        [event("e2", hoursAgo(4), "InTransit")],
        eta("2026-06-23T21:00:00Z"),
      ),
    );

    const noEta = await addShipment({ userId: user.id, eta: null });
    await apply(
      update(
        noEta.providerTrackerId!,
        "InTransit",
        [event("e3", hoursAgo(3), "InTransit")],
        eta("2026-06-30T18:00:00Z"),
      ),
    );

    expect(await alertsOf(row.id)).toHaveLength(0);
    expect(await alertsOf(noEta.id)).toHaveLength(0);
  });

  it("is skipped once the shipment is delivered", async () => {
    const user = await insertUser(ctx.db);
    const row = await addShipment({
      userId: user.id,
      eta: eta("2026-06-22T18:00:00Z"),
    });

    await apply(
      update(
        row.providerTrackerId!,
        "Delivered",
        [event("e1", hoursAgo(1), "Delivered")],
        eta("2026-06-25T18:00:00Z"),
      ),
    );

    expect((await alertsOf(row.id)).map((r) => r.kind)).toEqual(["delivered"]);
  });

  it("can accompany a status alert when both change", async () => {
    const user = await insertUser(ctx.db);
    const row = await addShipment({
      userId: user.id,
      eta: eta("2026-06-22T18:00:00Z"),
    });

    await apply(
      update(
        row.providerTrackerId!,
        "Exception",
        [event("e1", hoursAgo(1), "Exception")],
        eta("2026-06-26T18:00:00Z"),
      ),
    );

    expect((await alertsOf(row.id)).map((r) => r.kind).sort()).toEqual([
      "delay",
      "problem",
    ]);
  });
});
