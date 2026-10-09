// @vitest-environment node
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  createTestDb,
  insertShipment,
  insertUser,
} from "../../../tests/db/pglite";
import { getLastCheckpoint } from "./shipments";
import { checkpoints } from "./schema";
import { getUserEmail } from "./users";

let ctx: Awaited<ReturnType<typeof createTestDb>>;

beforeAll(async () => {
  ctx = await createTestDb();
});

afterAll(async () => {
  await ctx.client.close();
});

const NO_SUCH_ID = "99999999-9999-4999-8999-999999999999";

describe("getUserEmail", () => {
  it("returns the account's address, or null for no such user", async () => {
    const user = await insertUser(ctx.db);
    expect(await getUserEmail(ctx.db, user.id)).toBe(user.email);
    expect(await getUserEmail(ctx.db, NO_SUCH_ID)).toBeNull();
  });
});

describe("getLastCheckpoint", () => {
  const add = (
    shipmentId: string,
    id: string,
    occurredAt: string,
    message: string | null,
    locationText: string | null,
    eventOrder: number | null = null,
  ) =>
    ctx.db.insert(checkpoints).values({
      shipmentId,
      providerEventId: id,
      occurredAt: new Date(occurredAt),
      status: "InTransit",
      message,
      locationText,
      eventOrder,
    });

  it("returns the newest checkpoint's message and place", async () => {
    const user = await insertUser(ctx.db);
    const shipment = await insertShipment(ctx.db, user.id);
    await add(
      shipment.id,
      "old",
      "2026-06-10T08:00:00Z",
      "Picked up",
      "OSLO, NO",
    );
    await add(
      shipment.id,
      "new",
      "2026-06-12T08:00:00Z",
      "Out for delivery",
      "MEMPHIS, TN",
    );

    expect(await getLastCheckpoint(ctx.db, user.id, shipment.id)).toEqual({
      message: "Out for delivery",
      locationText: "MEMPHIS, TN",
    });
  });

  it("breaks a tie on time by the provider's event order", async () => {
    const user = await insertUser(ctx.db);
    const shipment = await insertShipment(ctx.db, user.id);
    await add(shipment.id, "a", "2026-06-12T08:00:00Z", "First", null, 1);
    await add(shipment.id, "b", "2026-06-12T08:00:00Z", "Second", null, 2);
    expect(
      (await getLastCheckpoint(ctx.db, user.id, shipment.id))?.message,
    ).toBe("Second");
  });

  it("returns null when there are no checkpoints", async () => {
    const user = await insertUser(ctx.db);
    const shipment = await insertShipment(ctx.db, user.id);
    expect(await getLastCheckpoint(ctx.db, user.id, shipment.id)).toBeNull();
  });

  it("returns null for another user's shipment, as if it did not exist", async () => {
    const owner = await insertUser(ctx.db);
    const other = await insertUser(ctx.db);
    const shipment = await insertShipment(ctx.db, owner.id);
    await add(shipment.id, "e", "2026-06-12T08:00:00Z", "Secret", "HOME");

    expect(await getLastCheckpoint(ctx.db, other.id, shipment.id)).toBeNull();
    expect(
      await getLastCheckpoint(ctx.db, owner.id, shipment.id),
    ).not.toBeNull();
  });

  it("returns null for a malformed or unknown id", async () => {
    const user = await insertUser(ctx.db);
    expect(await getLastCheckpoint(ctx.db, user.id, "not-a-uuid")).toBeNull();
    expect(await getLastCheckpoint(ctx.db, user.id, NO_SUCH_ID)).toBeNull();
  });
});
