// @vitest-environment node
import type { SupabaseClient } from "@supabase/supabase-js";
import { eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { createTestDb } from "../../../tests/db/pglite";
import { users } from "@/lib/db/schema";
import { completeSignIn } from "./callback";

let ctx: Awaited<ReturnType<typeof createTestDb>>;

beforeAll(async () => {
  ctx = await createTestDb();
});

afterAll(async () => {
  await ctx.client.close();
});

const ID = "22222222-2222-4222-8222-222222222222";

const clientReturning = (result: unknown) => {
  const exchangeCodeForSession = vi.fn().mockResolvedValue(result);
  return {
    client: { auth: { exchangeCodeForSession } } as unknown as Pick<
      SupabaseClient,
      "auth"
    >,
    exchangeCodeForSession,
  };
};

describe("completeSignIn", () => {
  it("returns false without calling Supabase when there is no code", async () => {
    const { client, exchangeCodeForSession } = clientReturning({});
    await expect(
      completeSignIn({ supabase: client, db: ctx.db, code: null }),
    ).resolves.toBe(false);
    expect(exchangeCodeForSession).not.toHaveBeenCalled();
  });

  it("returns false when the code exchange fails and creates no user", async () => {
    const { client } = clientReturning({
      data: { user: null },
      error: new Error("invalid code"),
    });
    await expect(
      completeSignIn({ supabase: client, db: ctx.db, code: "bad" }),
    ).resolves.toBe(false);
    expect(
      await ctx.db.select().from(users).where(eq(users.id, ID)),
    ).toHaveLength(0);
  });

  it("returns false when the account has no email", async () => {
    const { client } = clientReturning({
      data: { user: { id: ID, email: undefined } },
      error: null,
    });
    await expect(
      completeSignIn({ supabase: client, db: ctx.db, code: "ok" }),
    ).resolves.toBe(false);
  });

  it("creates the user row and returns true on success", async () => {
    const { client, exchangeCodeForSession } = clientReturning({
      data: { user: { id: ID, email: "new@example.test" } },
      error: null,
    });
    await expect(
      completeSignIn({ supabase: client, db: ctx.db, code: "good-code" }),
    ).resolves.toBe(true);
    expect(exchangeCodeForSession).toHaveBeenCalledWith("good-code");

    const rows = await ctx.db.select().from(users).where(eq(users.id, ID));
    expect(rows.map((r) => r.email)).toEqual(["new@example.test"]);
  });
});
