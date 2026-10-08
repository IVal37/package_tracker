// @vitest-environment node
import { eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createTestDb, insertUser } from "../../../tests/db/pglite";
import { slugFromEmail } from "@/lib/email/alias";
import { getOrCreateAlias, rotateAlias } from "./forwarding";
import { findUserIdByAlias } from "./inbound-sync";
import { users } from "./schema";

let ctx: Awaited<ReturnType<typeof createTestDb>>;

beforeAll(async () => {
  ctx = await createTestDb();
});

afterAll(async () => {
  await ctx.client.close();
});

const aliasOf = async (userId: string) =>
  (await ctx.db.select().from(users).where(eq(users.id, userId)))[0]
    ?.forwardingAlias;

/** Random source that yields the given 8 bytes first, then real randomness. */
const first = (bytes: number[]) => {
  let used = false;
  return (length: number) => {
    if (!used) {
      used = true;
      return new Uint8Array(bytes);
    }
    return globalThis.crypto.getRandomValues(new Uint8Array(length));
  };
};

describe("getOrCreateAlias", () => {
  it("creates an alias from the user's email on first use", async () => {
    const user = await insertUser(ctx.db);
    const alias = await getOrCreateAlias(ctx.db, user.id);

    expect(alias).toMatch(
      new RegExp(`^${slugFromEmail(user.email)}-[a-z0-9]{4}$`),
    );
    expect(await aliasOf(user.id)).toBe(alias);
  });

  it("returns the same alias every time afterwards", async () => {
    const user = await insertUser(ctx.db);
    const one = await getOrCreateAlias(ctx.db, user.id);
    const two = await getOrCreateAlias(ctx.db, user.id);
    expect(two).toBe(one);
  });

  it("gives two requests that race the same alias", async () => {
    const user = await insertUser(ctx.db);
    const [a, b] = await Promise.all([
      getOrCreateAlias(ctx.db, user.id),
      getOrCreateAlias(ctx.db, user.id),
    ]);
    expect(a).toBe(b);
    expect(await aliasOf(user.id)).toBe(a);
  });

  it("returns null for a user that does not exist", async () => {
    expect(
      await getOrCreateAlias(ctx.db, "99999999-9999-4999-8999-999999999999"),
    ).toBeNull();
  });

  it("draws again when the alias is already taken by someone else", async () => {
    const taken = await insertUser(ctx.db);
    const wanted = await insertUser(ctx.db);
    // The first draw (bytes 0..3 -> "abcd") collides with the other user's alias.
    await ctx.db
      .update(users)
      .set({ forwardingAlias: `${slugFromEmail(wanted.email)}-abcd` })
      .where(eq(users.id, taken.id));

    const alias = await getOrCreateAlias(
      ctx.db,
      wanted.id,
      first([0, 1, 2, 3, 4, 5, 6, 7]),
    );

    expect(alias).not.toBe(`${slugFromEmail(wanted.email)}-abcd`);
    expect(alias).toMatch(/-[a-z0-9]{4}$/);
    expect(await aliasOf(taken.id)).toBe(`${slugFromEmail(wanted.email)}-abcd`);
  });

  it("gives up with an error if every draw collides", async () => {
    const taken = await insertUser(ctx.db);
    const wanted = await insertUser(ctx.db);
    await ctx.db
      .update(users)
      .set({ forwardingAlias: `${slugFromEmail(wanted.email)}-abcd` })
      .where(eq(users.id, taken.id));

    await expect(
      getOrCreateAlias(
        ctx.db,
        wanted.id,
        () => new Uint8Array([0, 1, 2, 3, 4, 5, 6, 7]),
      ),
    ).rejects.toThrow("unique forwarding alias");
    expect(await aliasOf(wanted.id)).toBeNull();
  });
});

describe("rotateAlias", () => {
  it("replaces the alias, and the old address stops resolving at once", async () => {
    const user = await insertUser(ctx.db);
    const old = (await getOrCreateAlias(ctx.db, user.id))!;
    expect(await findUserIdByAlias(ctx.db, old)).toBe(user.id);

    const fresh = (await rotateAlias(ctx.db, user.id))!;

    expect(fresh).not.toBe(old);
    expect(await findUserIdByAlias(ctx.db, old)).toBeNull();
    expect(await findUserIdByAlias(ctx.db, fresh)).toBe(user.id);
  });

  it("creates an alias for a user that had none", async () => {
    const user = await insertUser(ctx.db);
    expect(await rotateAlias(ctx.db, user.id)).toMatch(/-[a-z0-9]{4}$/);
  });

  it("only ever changes the given user", async () => {
    const a = await insertUser(ctx.db);
    const b = await insertUser(ctx.db);
    const aliasA = await getOrCreateAlias(ctx.db, a.id);
    await getOrCreateAlias(ctx.db, b.id);

    await rotateAlias(ctx.db, b.id);

    expect(await aliasOf(a.id)).toBe(aliasA);
  });

  it("returns null for a user that does not exist", async () => {
    expect(
      await rotateAlias(ctx.db, "99999999-9999-4999-8999-999999999999"),
    ).toBeNull();
  });

  it("draws again on a collision, and gives up if every draw collides", async () => {
    const taken = await insertUser(ctx.db);
    const user = await insertUser(ctx.db);
    const slug = slugFromEmail(user.email);
    await ctx.db
      .update(users)
      .set({ forwardingAlias: `${slug}-abcd` })
      .where(eq(users.id, taken.id));

    const alias = await rotateAlias(
      ctx.db,
      user.id,
      first([0, 1, 2, 3, 4, 5, 6, 7]),
    );
    expect(alias).not.toBe(`${slug}-abcd`);

    await expect(
      rotateAlias(
        ctx.db,
        user.id,
        () => new Uint8Array([0, 1, 2, 3, 4, 5, 6, 7]),
      ),
    ).rejects.toThrow("unique forwarding alias");
  });
});

describe("findUserIdByAlias", () => {
  it("finds the owner of an alias", async () => {
    const user = await insertUser(ctx.db);
    const alias = (await getOrCreateAlias(ctx.db, user.id))!;
    expect(await findUserIdByAlias(ctx.db, alias)).toBe(user.id);
  });

  it("returns null for an unknown alias, and does not match case-insensitively", async () => {
    const user = await insertUser(ctx.db);
    const alias = (await getOrCreateAlias(ctx.db, user.id))!;
    expect(await findUserIdByAlias(ctx.db, "no-such-alias")).toBeNull();
    expect(await findUserIdByAlias(ctx.db, alias.toUpperCase())).toBeNull();
  });

  it("exposes nothing but the user id", async () => {
    const user = await insertUser(ctx.db);
    const alias = (await getOrCreateAlias(ctx.db, user.id))!;
    const result = await findUserIdByAlias(ctx.db, alias);
    expect(typeof result).toBe("string");
    expect(result).not.toContain("@");
  });
});
