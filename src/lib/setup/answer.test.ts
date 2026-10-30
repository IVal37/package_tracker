// @vitest-environment node
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createTestDb, insertUser } from "../../../tests/db/pglite";
import { getSetupAnswer } from "@/lib/db/setup";
import { LIMITS } from "@/lib/ratelimit";
import { answerSetup } from "./answer";

let ctx: Awaited<ReturnType<typeof createTestDb>>;

beforeAll(async () => {
  ctx = await createTestDb();
});

afterAll(async () => {
  await ctx.client.close();
});

const NOW = new Date("2026-10-30T12:00:00Z");

describe("answerSetup", () => {
  it("saves the answer for the user", async () => {
    const user = await insertUser(ctx.db);
    const result = await answerSetup({
      db: ctx.db,
      userId: user.id,
      answer: "completed",
      now: NOW,
    });
    expect(result).toBe("saved");
    expect(await getSetupAnswer(ctx.db, user.id)).toEqual({
      completedAt: NOW,
      skippedAt: null,
    });
  });

  it("says so when the account is gone, and stores nothing", async () => {
    const result = await answerSetup({
      db: ctx.db,
      userId: "99999999-9999-4999-8999-999999999999",
      answer: "skipped",
      now: NOW,
    });
    expect(result).toBe("no_account");
  });

  it("refuses past the limit, and one user's limit is not another's", async () => {
    const busy = await insertUser(ctx.db);
    const calm = await insertUser(ctx.db);
    for (let i = 0; i < LIMITS.setupAnswer.limit; i++) {
      await answerSetup({
        db: ctx.db,
        userId: busy.id,
        answer: "skipped",
        now: NOW,
      });
    }
    expect(
      await answerSetup({
        db: ctx.db,
        userId: busy.id,
        answer: "completed",
        now: NOW,
      }),
    ).toBe("rate_limited");
    // The refused answer was not saved.
    expect((await getSetupAnswer(ctx.db, busy.id))?.completedAt).toBeNull();

    expect(
      await answerSetup({
        db: ctx.db,
        userId: calm.id,
        answer: "completed",
        now: NOW,
      }),
    ).toBe("saved");
  });
});
