// @vitest-environment node
import { eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createTestDb, insertUser } from "../../../../tests/db/pglite";
import { shipments } from "@/lib/db/schema";
import {
  ARCHIVE_AFTER_DAYS,
  archiveDeliveredShipments,
} from "./archive-delivered";

const NOW = new Date("2026-06-20T12:00:00Z");
const HOUR = 3_600_000;
const ago = (hours: number) => new Date(NOW.getTime() - hours * HOUR);

let ctx: Awaited<ReturnType<typeof createTestDb>>;
let userId: string;

beforeAll(async () => {
  ctx = await createTestDb();
  userId = (await insertUser(ctx.db)).id;
});

afterAll(async () => {
  await ctx.client.close();
});

let seq = 0;
async function add(extra: Partial<typeof shipments.$inferInsert>) {
  const [row] = await ctx.db
    .insert(shipments)
    .values({
      userId,
      trackingNumber: `AD-${++seq}`,
      provider: "fake",
      ...extra,
    })
    .returning();
  if (!row) throw new Error("insert failed");
  return row;
}

const archivedAt = async (id: string) =>
  (await ctx.db.select().from(shipments).where(eq(shipments.id, id)))[0]
    ?.archivedAt;

describe("archiveDeliveredShipments", () => {
  it("uses a 14 day window", () => {
    expect(ARCHIVE_AFTER_DAYS).toBe(14);
  });

  it("archives only shipments delivered 14 or more days ago", async () => {
    const days = (n: number) => ago(n * 24);
    const old = await add({ status: "Delivered", lastEventAt: days(30) });
    const exactly = await add({ status: "Delivered", lastEventAt: days(14) });
    const justUnder = await add({
      status: "Delivered",
      lastEventAt: new Date(days(14).getTime() + 1000),
    });
    const stuck = await add({ status: "InTransit", lastEventAt: days(60) });
    const exception = await add({ status: "Exception", lastEventAt: days(60) });

    const result = await archiveDeliveredShipments({ db: ctx.db, now: NOW });

    expect(result).toEqual({ archived: 2 });
    expect(await archivedAt(old.id)).toEqual(NOW);
    expect(await archivedAt(exactly.id)).toEqual(NOW);
    expect(await archivedAt(justUnder.id)).toBeNull();
    expect(await archivedAt(stuck.id)).toBeNull();
    expect(await archivedAt(exception.id)).toBeNull();
  });

  it("a second run archives nothing more", async () => {
    expect(await archiveDeliveredShipments({ db: ctx.db, now: NOW })).toEqual({
      archived: 0,
    });
  });
});
