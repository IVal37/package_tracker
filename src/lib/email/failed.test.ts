// @vitest-environment node
import { eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createTestDb, insertUser } from "../../../tests/db/pglite";
import { inboundEmails } from "@/lib/db/schema";
import { failureReason, retryFailedEmail } from "./failed";

let ctx: Awaited<ReturnType<typeof createTestDb>>;

beforeAll(async () => {
  ctx = await createTestDb();
});

afterAll(async () => {
  await ctx.client.close();
});

const NOW = new Date("2026-10-09T12:00:00Z");

async function email(
  userId: string,
  parseStatus: "pending" | "parsed" | "failed" | "ignored",
) {
  const [row] = await ctx.db
    .insert(inboundEmails)
    .values({
      userId,
      raw: "{}",
      parseStatus,
      extracted: parseStatus === "failed" ? { error: "unreadable" } : null,
    })
    .returning();
  return row!;
}

const statusOf = async (id: string) =>
  (
    await ctx.db.select().from(inboundEmails).where(eq(inboundEmails.id, id))
  )[0];

describe("failureReason", () => {
  it.each([
    ["unreadable", "The email could not be opened."],
    [
      "The tracking provider is unavailable",
      "A service we rely on was down when it arrived.",
    ],
    ["Anthropic rate limit", "A service we rely on was down when it arrived."],
    [
      "Could not reach Anthropic",
      "A service we rely on was down when it arrived.",
    ],
    [
      "The model's answer was not valid JSON",
      "We couldn't make out the order or tracking details.",
    ],
    [
      "The model declined to read this email",
      "We couldn't make out the order or tracking details.",
    ],
    ["something new", "We couldn't read it."],
    [null, "We couldn't read it."],
  ])("explains %j plainly", (error, reason) => {
    expect(failureReason(error)).toBe(reason);
  });
});

describe("retryFailedEmail", () => {
  it("puts the user's failed email back to pending and clears the error", async () => {
    const user = await insertUser(ctx.db);
    const row = await email(user.id, "failed");

    expect(
      await retryFailedEmail({
        db: ctx.db,
        userId: user.id,
        emailId: row.id,
        now: NOW,
      }),
    ).toBe("retried");
    const after = await statusOf(row.id);
    expect(after?.parseStatus).toBe("pending");
    expect(after?.extracted).toBeNull();
  });

  it("cannot retry another user's email, which looks missing", async () => {
    const owner = await insertUser(ctx.db);
    const other = await insertUser(ctx.db);
    const row = await email(owner.id, "failed");

    expect(
      await retryFailedEmail({
        db: ctx.db,
        userId: other.id,
        emailId: row.id,
        now: NOW,
      }),
    ).toBe("not_found");
    expect((await statusOf(row.id))?.parseStatus).toBe("failed");
  });

  it.each(["pending", "parsed", "ignored"] as const)(
    "only retries a failed email, not a %s one",
    async (status) => {
      const user = await insertUser(ctx.db);
      const row = await email(user.id, status);
      expect(
        await retryFailedEmail({
          db: ctx.db,
          userId: user.id,
          emailId: row.id,
          now: NOW,
        }),
      ).toBe("not_found");
      expect((await statusOf(row.id))?.parseStatus).toBe(status);
    },
  );

  it("treats a malformed id as missing", async () => {
    const user = await insertUser(ctx.db);
    expect(
      await retryFailedEmail({
        db: ctx.db,
        userId: user.id,
        emailId: "nope",
        now: NOW,
      }),
    ).toBe("not_found");
  });

  it("is limited to ten an hour per user", async () => {
    const user = await insertUser(ctx.db);
    const results = [];
    for (let i = 0; i < 11; i++) {
      const row = await email(user.id, "failed");
      results.push(
        await retryFailedEmail({
          db: ctx.db,
          userId: user.id,
          emailId: row.id,
          now: NOW,
        }),
      );
    }
    expect(results.slice(0, 10).every((r) => r === "retried")).toBe(true);
    expect(results[10]).toBe("rate_limited");
  });
});
