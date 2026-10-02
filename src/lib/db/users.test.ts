// @vitest-environment node
import { eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createTestDb } from "../../../tests/db/pglite";
import { ensureUser } from "./users";
import { users } from "./schema";

let ctx: Awaited<ReturnType<typeof createTestDb>>;

beforeAll(async () => {
  ctx = await createTestDb();
});

afterAll(async () => {
  await ctx.client.close();
});

const ID = "11111111-1111-4111-8111-111111111111";

const rowsFor = (id: string) =>
  ctx.db.select().from(users).where(eq(users.id, id));

describe("ensureUser", () => {
  it("creates the user row keyed by the auth user id", async () => {
    await ensureUser(ctx.db, { id: ID, email: "a@example.test" });
    const rows = await rowsFor(ID);
    expect(rows).toHaveLength(1);
    expect(rows[0]?.email).toBe("a@example.test");
  });

  it("is idempotent and refreshes the email on later sign-ins", async () => {
    await ensureUser(ctx.db, { id: ID, email: "a@example.test" });
    await ensureUser(ctx.db, { id: ID, email: "renamed@example.test" });
    const rows = await rowsFor(ID);
    expect(rows).toHaveLength(1);
    expect(rows[0]?.email).toBe("renamed@example.test");
  });
});
