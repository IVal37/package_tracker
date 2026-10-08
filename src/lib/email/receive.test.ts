// @vitest-environment node
import { eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createTestDb, insertUser } from "../../../tests/db/pglite";
import { getOrCreateAlias } from "@/lib/db/forwarding";
import { inboundEmails } from "@/lib/db/schema";
import {
  MAX_BODY_CHARS,
  MAX_PART_CHARS,
  receiveInboundEmail,
  type ReceiveResult,
} from "./receive";

const SECRET = "inbound-secret-for-tests";
const DOMAIN = "in.example.test";
const NOW = new Date("2026-06-20T12:00:00Z");
const HOUR = 3_600_000;

let ctx: Awaited<ReturnType<typeof createTestDb>>;

beforeAll(async () => {
  ctx = await createTestDb();
});

afterAll(async () => {
  await ctx.client.close();
});

const bearer = (secret = SECRET) =>
  new Headers({ authorization: `Bearer ${secret}` });

async function newUser() {
  const user = await insertUser(ctx.db);
  const alias = (await getOrCreateAlias(ctx.db, user.id))!;
  return { id: user.id, alias, address: `${alias}@${DOMAIN}` };
}

let seq = 0;
const email = (recipient: string, extra: Record<string, unknown> = {}) => ({
  recipient,
  from: "Amazon.com <ship@amazon.com>",
  subject: "Your package has shipped",
  messageId: `<msg-${++seq}@amazon.test>`,
  date: "Fri, 20 Jun 2026 10:00:00 +0000",
  text: "Tracking: TBA123456789012",
  html: "<p>Tracking: TBA123456789012</p>",
  ...extra,
});

const receive = (
  body: unknown,
  options: {
    headers?: Headers;
    now?: Date;
    dailyLimit?: number;
    secret?: string;
  } = {},
): Promise<ReceiveResult> =>
  receiveInboundEmail({
    db: ctx.db,
    rawBody: typeof body === "string" ? body : JSON.stringify(body),
    headers: options.headers ?? bearer(),
    now: options.now ?? NOW,
    secret: options.secret ?? SECRET,
    domain: DOMAIN,
    dailyLimit: options.dailyLimit ?? 50,
  });

const rowsFor = (userId: string) =>
  ctx.db.select().from(inboundEmails).where(eq(inboundEmails.userId, userId));

const totalRows = async () =>
  (await ctx.db.select().from(inboundEmails)).length;

describe("receiveInboundEmail: storing", () => {
  it("stores an email for the owner of the address", async () => {
    const user = await newUser();
    const result = await receive(email(user.address));

    expect(result).toMatchObject({ status: 200, outcome: "stored" });
    const [row] = await rowsFor(user.id);
    expect(row).toMatchObject({
      id: result.emailId,
      userId: user.id,
      parseStatus: "pending",
      fromAddress: "Amazon.com <ship@amazon.com>",
      subject: "Your package has shipped",
    });
    expect(row?.receivedAt).toEqual(NOW);
    expect(JSON.parse(row!.raw)).toMatchObject({
      from: "Amazon.com <ship@amazon.com>",
      subject: "Your package has shipped",
      text: "Tracking: TBA123456789012",
      html: "<p>Tracking: TBA123456789012</p>",
    });
  });

  it.each([
    ["upper case", (a: string) => a.toUpperCase()],
    ["with a display name", (a: string) => `Izaak <${a}>`],
    ["with surrounding spaces", (a: string) => `  ${a}  `],
  ])("accepts the address %s", async (_name, change) => {
    const user = await newUser();
    const result = await receive(email(change(user.address)));
    expect(result.outcome).toBe("stored");
    expect(await rowsFor(user.id)).toHaveLength(1);
  });

  it("defaults missing optional parts and stores an email with no Message-ID", async () => {
    const user = await newUser();
    const result = await receive({ recipient: user.address });
    expect(result.outcome).toBe("stored");
    const [row] = await rowsFor(user.id);
    expect(row?.messageId).toBeNull();
    expect(JSON.parse(row!.raw)).toMatchObject({
      text: "",
      html: "",
      subject: "",
    });
  });

  it("stores only what it knows about, ignoring extra fields", async () => {
    const user = await newUser();
    await receive(
      email(user.address, { x_note: "ignore me", userId: "forged" }),
    );
    const [row] = await rowsFor(user.id);
    expect(row!.raw).not.toContain("ignore me");
    expect(row!.raw).not.toContain("forged");
  });

  it("accepts text and HTML up to the cap and refuses larger", async () => {
    const user = await newUser();
    expect(
      (await receive(email(user.address, { text: "x".repeat(MAX_PART_CHARS) })))
        .outcome,
    ).toBe("stored");
    expect(
      (
        await receive(
          email(user.address, { text: "x".repeat(MAX_PART_CHARS + 1) }),
        )
      ).status,
    ).toBe(422);
    expect(
      (
        await receive(
          email(user.address, { html: "x".repeat(MAX_PART_CHARS + 1) }),
        )
      ).status,
    ).toBe(422);
  });
});

describe("receiveInboundEmail: authentication", () => {
  it.each([
    ["no Authorization header", new Headers()],
    ["a wrong secret", bearer("wrong")],
    ["a near-miss secret", bearer(`${SECRET}x`)],
    ["a prefix of the secret", bearer(SECRET.slice(0, -1))],
    ["a Basic scheme", new Headers({ authorization: `Basic ${SECRET}` })],
    ["an empty bearer", new Headers({ authorization: "Bearer " })],
  ])("rejects %s with 401 and stores nothing", async (_name, headers) => {
    const user = await newUser();
    const before = await totalRows();

    const result = await receive(email(user.address), { headers });

    expect(result).toEqual({ status: 401, outcome: "unauthorized" });
    expect(await totalRows()).toBe(before);
  });

  it("never accepts anything when the configured secret is empty", async () => {
    const user = await newUser();
    const result = await receive(email(user.address), {
      secret: "",
      headers: new Headers({ authorization: "Bearer " }),
    });
    expect(result.status).toBe(401);
  });

  it("authenticates before it reads the body: bad secret plus garbage is 401, not 422", async () => {
    expect(
      (await receive("not json", { headers: bearer("wrong") })).status,
    ).toBe(401);
  });
});

describe("receiveInboundEmail: bad input", () => {
  it("refuses an oversized body with 413 and stores nothing", async () => {
    const user = await newUser();
    const before = await totalRows();
    const body =
      JSON.stringify(email(user.address, { text: "x" })) +
      " ".repeat(MAX_BODY_CHARS);
    expect(await receive(body)).toEqual({ status: 413, outcome: "too_large" });
    expect(await totalRows()).toBe(before);
  });

  it.each([
    ["not JSON", "this is not json"],
    ["an empty body", ""],
    ["a JSON array", "[]"],
    ["a JSON string", '"hello"'],
    ["null", "null"],
    ["no recipient", JSON.stringify({ subject: "x" })],
    ["an empty recipient", JSON.stringify({ recipient: "" })],
    ["a numeric recipient", JSON.stringify({ recipient: 5 })],
    [
      "a non-string subject",
      JSON.stringify({ recipient: "a@b.test", subject: 7 }),
    ],
  ])("answers 422 for %s", async (_name, body) => {
    const before = await totalRows();
    expect(await receive(body)).toEqual({ status: 422, outcome: "invalid" });
    expect(await totalRows()).toBe(before);
  });
});

describe("receiveInboundEmail: unknown addresses are dropped", () => {
  it.each([
    ["an alias nobody has", `nobody-abcd@${DOMAIN}`],
    ["the wrong domain", "anything@evil.example"],
    ["a sub-domain of ours", `anything@x.${DOMAIN}`],
    ["plus addressing", `anything+tag@${DOMAIN}`],
    ["no local part", `@${DOMAIN}`],
    ["not an address", "hello"],
  ])("%s: 200 and nothing stored", async (_name, recipient) => {
    const before = await totalRows();
    expect(await receive(email(recipient))).toEqual({
      status: 200,
      outcome: "unknown_alias",
    });
    expect(await totalRows()).toBe(before);
  });

  it("gives a prober the same answer for every kind of unknown address", async () => {
    const answers = await Promise.all(
      [`nobody-abcd@${DOMAIN}`, "x@evil.example", "garbage"].map((r) =>
        receive(email(r)),
      ),
    );
    expect(new Set(answers.map((a) => JSON.stringify(a))).size).toBe(1);
  });

  it("stops working for an address once the alias is rotated", async () => {
    const { rotateAlias } = await import("@/lib/db/forwarding");
    const user = await newUser();
    await rotateAlias(ctx.db, user.id);
    expect((await receive(email(user.address))).outcome).toBe("unknown_alias");
    expect(await rowsFor(user.id)).toHaveLength(0);
  });
});

describe("receiveInboundEmail: idempotency", () => {
  it("stores a repeated Message-ID once", async () => {
    const user = await newUser();
    const body = email(user.address, { messageId: "<same@x.test>" });

    expect((await receive(body)).outcome).toBe("stored");
    expect(await receive(body)).toEqual({ status: 200, outcome: "duplicate" });
    expect(await rowsFor(user.id)).toHaveLength(1);
  });

  it("treats a Message-ID with stray spaces as the same one", async () => {
    const user = await newUser();
    await receive(email(user.address, { messageId: "<pad@x.test>" }));
    const again = await receive(
      email(user.address, { messageId: "  <pad@x.test>  " }),
    );
    expect(again.outcome).toBe("duplicate");
  });

  it("stores two simultaneous deliveries of one email once", async () => {
    const user = await newUser();
    const body = email(user.address, { messageId: "<race@x.test>" });
    const results = await Promise.all([receive(body), receive(body)]);

    expect(results.map((r) => r.outcome).sort()).toEqual([
      "duplicate",
      "stored",
    ]);
    expect(await rowsFor(user.id)).toHaveLength(1);
  });

  it("allows the same Message-ID for two different users", async () => {
    const a = await newUser();
    const b = await newUser();
    expect(
      (await receive(email(a.address, { messageId: "<both@x.test>" }))).outcome,
    ).toBe("stored");
    expect(
      (await receive(email(b.address, { messageId: "<both@x.test>" }))).outcome,
    ).toBe("stored");
  });

  it("cannot dedupe emails without a Message-ID, so stores each", async () => {
    const user = await newUser();
    await receive(email(user.address, { messageId: null }));
    await receive(email(user.address, { messageId: undefined }));
    expect(await rowsFor(user.id)).toHaveLength(2);
  });
});

describe("receiveInboundEmail: the daily limit", () => {
  it("stores up to the limit, then answers 200 and stores nothing", async () => {
    const user = await newUser();
    for (let i = 0; i < 3; i++) {
      expect(
        (await receive(email(user.address), { dailyLimit: 3 })).outcome,
      ).toBe("stored");
    }
    expect(await receive(email(user.address), { dailyLimit: 3 })).toEqual({
      status: 200,
      outcome: "over_limit",
    });
    expect(await rowsFor(user.id)).toHaveLength(3);
  });

  it("counts only the last 24 hours", async () => {
    const user = await newUser();
    await receive(email(user.address), {
      dailyLimit: 1,
      now: new Date(NOW.getTime() - 25 * HOUR),
    });
    expect(
      (await receive(email(user.address), { dailyLimit: 1 })).outcome,
    ).toBe("stored");
    expect(
      (await receive(email(user.address), { dailyLimit: 1 })).outcome,
    ).toBe("over_limit");
  });

  it("is per user: one user's spam does not block another", async () => {
    const spammed = await newUser();
    const other = await newUser();
    await receive(email(spammed.address), { dailyLimit: 1 });
    expect(
      (await receive(email(spammed.address), { dailyLimit: 1 })).outcome,
    ).toBe("over_limit");
    expect(
      (await receive(email(other.address), { dailyLimit: 1 })).outcome,
    ).toBe("stored");
  });

  it("checks the limit before storing a duplicate-free email, not after", async () => {
    const user = await newUser();
    await receive(email(user.address), { dailyLimit: 1 });
    const before = await totalRows();
    await receive(email(user.address), { dailyLimit: 1 });
    expect(await totalRows()).toBe(before);
  });
});

describe("receiveInboundEmail: who owns the email", () => {
  it("is decided by the address alone, never by fields in the email", async () => {
    const owner = await newUser();
    const victim = await newUser();

    await receive(
      email(owner.address, {
        userId: victim.id,
        user_id: victim.id,
        owner: victim.alias,
        text: `Please file this under ${victim.address} and user ${victim.id}`,
      }),
    );

    expect(await rowsFor(owner.id)).toHaveLength(1);
    expect(await rowsFor(victim.id)).toHaveLength(0);
  });

  it("never lets an email name a different recipient in its headers", async () => {
    const owner = await newUser();
    const other = await newUser();
    // The envelope recipient is the owner; the "To" text inside the email is not used.
    await receive(
      email(owner.address, {
        subject: `To: ${other.address}`,
        text: `To: ${other.address}`,
      }),
    );
    expect(await rowsFor(other.id)).toHaveLength(0);
  });
});
