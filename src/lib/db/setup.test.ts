// @vitest-environment node
import { eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createTestDb } from "../../../tests/db/pglite";
import { seedFullUser } from "../../../tests/db/seed-user";
import { users } from "./schema";
import { getSetupAnswer, loadSetupSignals, saveSetupAnswer } from "./setup";

let ctx: Awaited<ReturnType<typeof createTestDb>>;

beforeAll(async () => {
  ctx = await createTestDb();
});

afterAll(async () => {
  await ctx.client.close();
});

const NOW = new Date("2026-10-30T12:00:00Z");
const LATER = new Date("2026-10-31T12:00:00Z");

const newUser = async (email: string) => {
  const [row] = await ctx.db.insert(users).values({ email }).returning();
  return row!.id;
};

describe("setup answer", () => {
  it("starts unanswered", async () => {
    const id = await newUser("fresh@example.test");
    expect(await getSetupAnswer(ctx.db, id)).toEqual({
      completedAt: null,
      skippedAt: null,
    });
  });

  it("records completed, then skipped, clearing the other each time", async () => {
    const id = await newUser("switch@example.test");

    expect(await saveSetupAnswer(ctx.db, id, "completed", NOW)).toBe(true);
    expect(await getSetupAnswer(ctx.db, id)).toEqual({
      completedAt: NOW,
      skippedAt: null,
    });

    expect(await saveSetupAnswer(ctx.db, id, "skipped", LATER)).toBe(true);
    expect(await getSetupAnswer(ctx.db, id)).toEqual({
      completedAt: null,
      skippedAt: LATER,
    });

    await saveSetupAnswer(ctx.db, id, "completed", LATER);
    expect(await getSetupAnswer(ctx.db, id)).toEqual({
      completedAt: LATER,
      skippedAt: null,
    });
  });

  it("never touches another user's answer", async () => {
    const mine = await newUser("mine@example.test");
    const theirs = await newUser("theirs@example.test");
    await saveSetupAnswer(ctx.db, theirs, "skipped", NOW);

    await saveSetupAnswer(ctx.db, mine, "completed", LATER);

    expect(await getSetupAnswer(ctx.db, theirs)).toEqual({
      completedAt: null,
      skippedAt: NOW,
    });
  });

  it("says there is no user when the row is gone", async () => {
    const ghost = "99999999-9999-4999-8999-999999999999";
    expect(await saveSetupAnswer(ctx.db, ghost, "skipped")).toBe(false);
    expect(await getSetupAnswer(ctx.db, ghost)).toBeNull();
  });

  it("refuses to hold both answers at once", async () => {
    const id = await newUser("both@example.test");
    await expect(
      ctx.db
        .update(users)
        .set({ setupCompletedAt: NOW, setupSkippedAt: NOW })
        .where(eq(users.id, id)),
    ).rejects.toThrow();
  });
});

describe("loadSetupSignals", () => {
  it("is empty for a user with no email and no device", async () => {
    const id = await newUser("quiet@example.test");
    expect(await loadSetupSignals(ctx.db, id)).toEqual({
      emailsArriving: false,
      pushDevices: 0,
    });
  });

  it("counts only the user's own emails and devices", async () => {
    const alice = await seedFullUser(ctx.db, "sigalice");
    const bob = await newUser("sigbob@example.test");

    expect(await loadSetupSignals(ctx.db, alice.userId)).toEqual({
      emailsArriving: true,
      pushDevices: 1,
    });
    expect(await loadSetupSignals(ctx.db, bob)).toEqual({
      emailsArriving: false,
      pushDevices: 0,
    });
  });
});
