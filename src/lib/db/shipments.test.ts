// @vitest-environment node
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { NormalizedEvent } from "@/lib/tracking/types";
import { createTestDb, insertUser } from "../../../tests/db/pglite";
import {
  createShipmentWithCheckpoints,
  deleteShipment,
  findShipmentByTrackingNumber,
  getShipment,
  getShipmentDetail,
  isUniqueViolation,
  listShipments,
  type NewShipment,
} from "./shipments";

let ctx: Awaited<ReturnType<typeof createTestDb>>;

beforeAll(async () => {
  ctx = await createTestDb();
});

afterAll(async () => {
  await ctx.client.close();
});

const event = (id: string, hour: number, order: number | null = null) =>
  ({
    providerEventId: id,
    occurredAt: new Date(Date.UTC(2026, 0, 1, hour)),
    status: "InTransit",
    message: `message ${id}`,
    locationText: `place ${id}`,
    courierCode: "fake-courier",
    order,
  }) satisfies NormalizedEvent;

const shipmentData = (trackingNumber: string): NewShipment => ({
  trackingNumber,
  courier: "fake-courier",
  nickname: null,
  provider: "fake",
  providerTrackerId: `fake:${trackingNumber}`,
  status: "InTransit",
  eta: null,
  lastEventAt: null,
});

const NO_SUCH_ID = "99999999-9999-4999-8999-999999999999";

describe("ownership isolation (user A vs user B)", () => {
  it("never lists another user's shipments", async () => {
    const a = await insertUser(ctx.db);
    const b = await insertUser(ctx.db);
    const aId = await createShipmentWithCheckpoints(
      ctx.db,
      a.id,
      shipmentData("A-LIST-1"),
      [event("a1", 1)],
    );
    await createShipmentWithCheckpoints(
      ctx.db,
      b.id,
      shipmentData("B-LIST-1"),
      [event("b1", 1)],
    );

    const aList = await listShipments(ctx.db, a.id);
    const bList = await listShipments(ctx.db, b.id);

    expect(aList.map((s) => s.id)).toEqual([aId]);
    expect(bList.map((s) => s.trackingNumber)).toEqual(["B-LIST-1"]);
    expect(aList.map((s) => s.trackingNumber)).not.toContain("B-LIST-1");
  });

  it("returns null when B asks for A's shipment detail", async () => {
    const a = await insertUser(ctx.db);
    const b = await insertUser(ctx.db);
    const aId = await createShipmentWithCheckpoints(
      ctx.db,
      a.id,
      shipmentData("A-DETAIL-1"),
      [event("d1", 1)],
    );

    expect(await getShipmentDetail(ctx.db, b.id, aId)).toBeNull();
    expect(await getShipment(ctx.db, b.id, aId)).toBeNull();
    expect(await getShipmentDetail(ctx.db, a.id, aId)).not.toBeNull();
  });

  it("does not let B delete A's shipment", async () => {
    const a = await insertUser(ctx.db);
    const b = await insertUser(ctx.db);
    const aId = await createShipmentWithCheckpoints(
      ctx.db,
      a.id,
      shipmentData("A-DELETE-1"),
      [],
    );

    expect(await deleteShipment(ctx.db, b.id, aId)).toBe(false);
    expect(await getShipment(ctx.db, a.id, aId)).not.toBeNull();
    expect(await deleteShipment(ctx.db, a.id, aId)).toBe(true);
    expect(await getShipment(ctx.db, a.id, aId)).toBeNull();
  });

  it("scopes tracking-number lookups to the user", async () => {
    const a = await insertUser(ctx.db);
    const b = await insertUser(ctx.db);
    await createShipmentWithCheckpoints(
      ctx.db,
      a.id,
      shipmentData("SHARED-LOOKUP"),
      [],
    );

    expect(
      await findShipmentByTrackingNumber(ctx.db, a.id, "SHARED-LOOKUP"),
    ).not.toBeNull();
    expect(
      await findShipmentByTrackingNumber(ctx.db, b.id, "SHARED-LOOKUP"),
    ).toBeNull();
  });
});

describe("malformed and missing ids", () => {
  it("treats a malformed uuid as not found instead of throwing", async () => {
    const a = await insertUser(ctx.db);
    expect(await getShipment(ctx.db, a.id, "not-a-uuid")).toBeNull();
    expect(
      await getShipmentDetail(ctx.db, a.id, "'; drop table users;--"),
    ).toBeNull();
    expect(await deleteShipment(ctx.db, a.id, "not-a-uuid")).toBe(false);
  });

  it("returns null/false for a well-formed id that does not exist", async () => {
    const a = await insertUser(ctx.db);
    expect(await getShipment(ctx.db, a.id, NO_SUCH_ID)).toBeNull();
    expect(await deleteShipment(ctx.db, a.id, NO_SUCH_ID)).toBe(false);
  });
});

describe("listShipments", () => {
  it("attaches the latest checkpoint to each shipment", async () => {
    const a = await insertUser(ctx.db);
    await createShipmentWithCheckpoints(
      ctx.db,
      a.id,
      shipmentData("LATEST-1"),
      [event("old", 1), event("new", 5), event("mid", 3)],
    );

    const [item] = await listShipments(ctx.db, a.id);
    expect(item?.lastCheckpoint).toEqual({
      message: "message new",
      locationText: "place new",
      occurredAt: new Date(Date.UTC(2026, 0, 1, 5)),
    });
  });

  it("breaks timestamp ties by higher event order", async () => {
    const a = await insertUser(ctx.db);
    await createShipmentWithCheckpoints(ctx.db, a.id, shipmentData("TIE-1"), [
      event("low", 5, 1),
      event("high", 5, 2),
    ]);
    const [item] = await listShipments(ctx.db, a.id);
    expect(item?.lastCheckpoint?.message).toBe("message high");
  });

  it("gives a null lastCheckpoint when there are no events", async () => {
    const a = await insertUser(ctx.db);
    await createShipmentWithCheckpoints(
      ctx.db,
      a.id,
      shipmentData("EMPTY-1"),
      [],
    );
    const [item] = await listShipments(ctx.db, a.id);
    expect(item?.lastCheckpoint).toBeNull();
  });

  it("returns an empty list for a user with no shipments", async () => {
    const a = await insertUser(ctx.db);
    expect(await listShipments(ctx.db, a.id)).toEqual([]);
  });

  it("excludes archived shipments", async () => {
    const a = await insertUser(ctx.db);
    const id = await createShipmentWithCheckpoints(
      ctx.db,
      a.id,
      shipmentData("ARCHIVED-1"),
      [event("x", 1)],
    );
    await ctx.client.query(
      "update shipments set archived_at = now() where id = $1",
      [id],
    );
    expect(await listShipments(ctx.db, a.id)).toEqual([]);
  });
});

describe("getShipmentDetail", () => {
  it("returns the timeline newest first", async () => {
    const a = await insertUser(ctx.db);
    const id = await createShipmentWithCheckpoints(
      ctx.db,
      a.id,
      shipmentData("TIMELINE-1"),
      [event("t1", 1), event("t3", 3), event("t2", 2)],
    );
    const detail = await getShipmentDetail(ctx.db, a.id, id);
    expect(detail?.checkpoints.map((c) => c.providerEventId)).toEqual([
      "t3",
      "t2",
      "t1",
    ]);
  });
});

describe("createShipmentWithCheckpoints", () => {
  it("rolls back the shipment if the user already has that tracking number", async () => {
    const a = await insertUser(ctx.db);
    await createShipmentWithCheckpoints(
      ctx.db,
      a.id,
      shipmentData("DUP-1"),
      [],
    );

    const attempt = createShipmentWithCheckpoints(
      ctx.db,
      a.id,
      shipmentData("DUP-1"),
      [event("dup", 1)],
    );
    await expect(attempt).rejects.toSatisfy(isUniqueViolation);
    expect(await listShipments(ctx.db, a.id)).toHaveLength(1);
  });

  it("allows the same tracking number for a different user", async () => {
    const a = await insertUser(ctx.db);
    const b = await insertUser(ctx.db);
    await createShipmentWithCheckpoints(
      ctx.db,
      a.id,
      shipmentData("BOTH-1"),
      [],
    );
    await expect(
      createShipmentWithCheckpoints(ctx.db, b.id, shipmentData("BOTH-1"), []),
    ).resolves.toEqual(expect.any(String));
  });
});

describe("isUniqueViolation", () => {
  it.each([
    [{ code: "23505" }, true],
    [{ cause: { code: "23505" } }, true],
    [{ code: "23503" }, false],
    [new Error("boom"), false],
    [null, false],
    ["23505", false],
  ])("%o -> %s", (error, expected) => {
    expect(isUniqueViolation(error)).toBe(expected);
  });
});
