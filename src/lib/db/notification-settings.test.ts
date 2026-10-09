// @vitest-environment node
import { eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createTestDb, insertUser } from "../../../tests/db/pglite";
import { DEFAULT_PREFS } from "@/lib/notifications/prefs";
import {
  getNotificationPrefs,
  saveNotificationPrefs,
} from "./notification-settings";
import { notificationSettings } from "./schema";

let ctx: Awaited<ReturnType<typeof createTestDb>>;

beforeAll(async () => {
  ctx = await createTestDb();
});

afterAll(async () => {
  await ctx.client.close();
});

const custom = () => {
  const prefs = structuredClone(DEFAULT_PREFS);
  prefs.push.delay = false;
  prefs.email.out_for_delivery = true;
  prefs.quiet = {
    enabled: true,
    start: 23 * 60,
    end: 6 * 60 + 30,
    timeZone: "Europe/Paris",
  };
  return prefs;
};

describe("getNotificationPrefs", () => {
  it("gives the defaults to a user who never saved any, without creating a row", async () => {
    const user = await insertUser(ctx.db);
    expect(await getNotificationPrefs(ctx.db, user.id)).toEqual(DEFAULT_PREFS);
    expect(
      await ctx.db
        .select()
        .from(notificationSettings)
        .where(eq(notificationSettings.userId, user.id)),
    ).toHaveLength(0);
  });
});

describe("saveNotificationPrefs", () => {
  it("creates the row on first save and reads it back", async () => {
    const user = await insertUser(ctx.db);
    await saveNotificationPrefs(ctx.db, user.id, custom());
    expect(await getNotificationPrefs(ctx.db, user.id)).toEqual(custom());
  });

  it("updates the same row on later saves, and stamps the time", async () => {
    const user = await insertUser(ctx.db);
    await saveNotificationPrefs(
      ctx.db,
      user.id,
      custom(),
      new Date("2026-06-01T00:00:00Z"),
    );
    await saveNotificationPrefs(
      ctx.db,
      user.id,
      DEFAULT_PREFS,
      new Date("2026-06-02T00:00:00Z"),
    );

    const rows = await ctx.db
      .select()
      .from(notificationSettings)
      .where(eq(notificationSettings.userId, user.id));
    expect(rows).toHaveLength(1);
    expect(rows[0]?.updatedAt).toEqual(new Date("2026-06-02T00:00:00Z"));
    expect(await getNotificationPrefs(ctx.db, user.id)).toEqual(DEFAULT_PREFS);
  });

  it("only ever changes the given user", async () => {
    const a = await insertUser(ctx.db);
    const b = await insertUser(ctx.db);
    await saveNotificationPrefs(ctx.db, b.id, custom());
    await saveNotificationPrefs(ctx.db, a.id, DEFAULT_PREFS);

    expect(await getNotificationPrefs(ctx.db, b.id)).toEqual(custom());
    expect(await getNotificationPrefs(ctx.db, a.id)).toEqual(DEFAULT_PREFS);
  });

  it("lets the database refuse quiet minutes outside a day", async () => {
    const user = await insertUser(ctx.db);
    const bad = custom();
    bad.quiet.start = 1440;
    await expect(saveNotificationPrefs(ctx.db, user.id, bad)).rejects.toThrow();
  });
});
