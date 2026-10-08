// @vitest-environment node
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createTestDb, insertUser } from "../../../tests/db/pglite";
import {
  countEmailsSince,
  countFailedEmails,
  finishEmail,
  hasMessageId,
  insertInboundEmail,
  latestGmailConfirmation,
} from "./inbound-emails";
import { inboundEmails } from "./schema";

let ctx: Awaited<ReturnType<typeof createTestDb>>;

beforeAll(async () => {
  ctx = await createTestDb();
});

afterAll(async () => {
  await ctx.client.close();
});

const NOW = new Date("2026-06-20T12:00:00Z");
const DAY = 24 * 60 * 60 * 1000;
const daysAgo = (days: number) => new Date(NOW.getTime() - days * DAY);

const email = (extra: Partial<Parameters<typeof insertInboundEmail>[2]> = {}) => ({
  raw: "{}",
  messageId: null,
  fromAddress: null,
  subject: null,
  receivedAt: NOW,
  ...extra,
});

async function addIgnored(userId: string, extracted: unknown, receivedAt: Date) {
  await ctx.db
    .insert(inboundEmails)
    .values({ userId, raw: "{}", parseStatus: "ignored", extracted, receivedAt });
}

describe("insertInboundEmail and hasMessageId", () => {
  it("returns the new id, and null for the same Message-ID again", async () => {
    const user = await insertUser(ctx.db);
    const first = await insertInboundEmail(ctx.db, user.id, email({ messageId: "<a@x>" }));
    expect(first).toEqual(expect.any(String));
    expect(await insertInboundEmail(ctx.db, user.id, email({ messageId: "<a@x>" }))).toBeNull();
    expect(await hasMessageId(ctx.db, user.id, "<a@x>")).toBe(true);
    expect(await hasMessageId(ctx.db, user.id, "<other@x>")).toBe(false);
  });

  it("does not see another user's Message-ID", async () => {
    const a = await insertUser(ctx.db);
    const b = await insertUser(ctx.db);
    await insertInboundEmail(ctx.db, a.id, email({ messageId: "<shared@x>" }));
    expect(await hasMessageId(ctx.db, b.id, "<shared@x>")).toBe(false);
  });
});

describe("countEmailsSince", () => {
  it("counts only this user's emails after the moment", async () => {
    const a = await insertUser(ctx.db);
    const b = await insertUser(ctx.db);
    await insertInboundEmail(ctx.db, a.id, email({ receivedAt: daysAgo(0.5) }));
    await insertInboundEmail(ctx.db, a.id, email({ receivedAt: daysAgo(3) }));
    await insertInboundEmail(ctx.db, b.id, email({ receivedAt: daysAgo(0.1) }));

    expect(await countEmailsSince(ctx.db, a.id, daysAgo(1))).toBe(1);
    expect(await countEmailsSince(ctx.db, a.id, daysAgo(10))).toBe(2);
    expect(await countEmailsSince(ctx.db, b.id, daysAgo(1))).toBe(1);
  });
});

describe("finishEmail", () => {
  it("records the result of a pending email, once", async () => {
    const user = await insertUser(ctx.db);
    const id = (await insertInboundEmail(ctx.db, user.id, email()))!;

    expect(await finishEmail(ctx.db, user.id, id, "parsed", { a: 1 })).toBe(true);
    expect(await finishEmail(ctx.db, user.id, id, "failed", { b: 2 })).toBe(false);

    const [row] = await ctx.db.select().from(inboundEmails);
    expect(row).toBeDefined();
  });

  it("cannot finish another user's email", async () => {
    const owner = await insertUser(ctx.db);
    const intruder = await insertUser(ctx.db);
    const id = (await insertInboundEmail(ctx.db, owner.id, email()))!;
    expect(await finishEmail(ctx.db, intruder.id, id, "parsed", {})).toBe(false);
    expect(await finishEmail(ctx.db, owner.id, id, "parsed", {})).toBe(true);
  });
});

describe("latestGmailConfirmation", () => {
  const confirmation = (code: string) => ({
    kind: "gmail_forwarding_confirmation",
    code,
  });

  it("returns the newest code inside the window", async () => {
    const user = await insertUser(ctx.db);
    await addIgnored(user.id, confirmation("11111111"), daysAgo(2));
    await addIgnored(user.id, confirmation("22222222"), daysAgo(1));

    expect(await latestGmailConfirmation(ctx.db, user.id, daysAgo(3))).toEqual({
      code: "22222222",
      receivedAt: daysAgo(1),
    });
  });

  it("ignores codes older than the window", async () => {
    const user = await insertUser(ctx.db);
    await addIgnored(user.id, confirmation("33333333"), daysAgo(5));
    expect(await latestGmailConfirmation(ctx.db, user.id, daysAgo(3))).toBeNull();
  });

  it("is only ever the user's own code", async () => {
    const a = await insertUser(ctx.db);
    const b = await insertUser(ctx.db);
    await addIgnored(a.id, confirmation("44444444"), daysAgo(1));
    expect(await latestGmailConfirmation(ctx.db, b.id, daysAgo(3))).toBeNull();
  });

  it.each([
    ["another kind of ignored email", { kind: "other" }],
    ["a code with letters", { kind: "gmail_forwarding_confirmation", code: "12ab34cd" }],
    ["a code that is too short", { kind: "gmail_forwarding_confirmation", code: "123" }],
    ["a link instead of a code", { kind: "gmail_forwarding_confirmation", code: "https://evil.test" }],
    ["no extraction", null],
    ["a non-object", "text"],
  ])("skips %s", async (_name, extracted) => {
    const user = await insertUser(ctx.db);
    await addIgnored(user.id, extracted, daysAgo(1));
    expect(await latestGmailConfirmation(ctx.db, user.id, daysAgo(3))).toBeNull();
  });

  it("skips a bad newer row and still finds an older valid one", async () => {
    const user = await insertUser(ctx.db);
    await addIgnored(user.id, confirmation("55555555"), daysAgo(2));
    await addIgnored(user.id, { kind: "other" }, daysAgo(1));
    expect((await latestGmailConfirmation(ctx.db, user.id, daysAgo(3)))?.code).toBe("55555555");
  });
});

describe("countFailedEmails", () => {
  it("counts only this user's failed emails", async () => {
    const a = await insertUser(ctx.db);
    const b = await insertUser(ctx.db);
    for (const status of ["failed", "failed", "parsed", "pending"] as const) {
      await ctx.db
        .insert(inboundEmails)
        .values({ userId: a.id, raw: "{}", parseStatus: status });
    }
    await ctx.db.insert(inboundEmails).values({ userId: b.id, raw: "{}", parseStatus: "failed" });

    expect(await countFailedEmails(ctx.db, a.id)).toBe(2);
    expect(await countFailedEmails(ctx.db, b.id)).toBe(1);
  });

  it("is zero for a user with no emails", async () => {
    const user = await insertUser(ctx.db);
    expect(await countFailedEmails(ctx.db, user.id)).toBe(0);
  });
});
