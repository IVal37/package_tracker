// @vitest-environment node
import { eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createTestDb, insertUser } from "../../../../tests/db/pglite";
import fakeWebhookFixture from "../../../../tests/fixtures/fake/webhook-ofd.json";
import ship24WebhookFixture from "../../../../tests/fixtures/ship24/webhook-events.json";
import { checkpoints, shipments } from "@/lib/db/schema";
import { createTrackingProvider } from "@/lib/tracking";
import { handleTrackingWebhook } from "./handle-webhook";

const SECRET = "test-webhook-secret";
const SHIP24_TRACKER = "26148317-7502-d3ac-44a9-546d240ac0dd";
const NOW = new Date("2026-06-20T12:00:00Z");

const env = {
  TRACKING_PROVIDER: "fake" as const,
  SHIP24_API_KEY: "api-key-not-used",
  SHIP24_WEBHOOK_SECRET: SECRET,
  FAKE_WEBHOOK_SECRET: SECRET,
};
const fake = createTrackingProvider(env);
const ship24 = createTrackingProvider({ ...env, TRACKING_PROVIDER: "ship24" });

let ctx: Awaited<ReturnType<typeof createTestDb>>;

beforeAll(async () => {
  ctx = await createTestDb();
});

afterAll(async () => {
  await ctx.client.close();
});

const auth = (secret = SECRET) =>
  new Headers({ authorization: `Bearer ${secret}` });

let seq = 0;
async function addShipment(provider: string, providerTrackerId: string) {
  const user = await insertUser(ctx.db);
  const [row] = await ctx.db
    .insert(shipments)
    .values({
      userId: user.id,
      trackingNumber: `WH-${++seq}`,
      provider,
      providerTrackerId,
    })
    .returning();
  if (!row) throw new Error("insert failed");
  return row;
}

const reload = async (id: string) => {
  const [row] = await ctx.db
    .select()
    .from(shipments)
    .where(eq(shipments.id, id));
  if (!row) throw new Error("missing");
  return row;
};

const eventCount = async (id: string) =>
  (
    await ctx.db
      .select()
      .from(checkpoints)
      .where(eq(checkpoints.shipmentId, id))
  ).length;

// A fake-provider webhook body: one tracking with one event.
function fakeBody(
  trackerId: string,
  status: string,
  eventId: string,
  occurredAt: string,
) {
  return JSON.stringify({
    trackings: [
      {
        providerTrackerId: trackerId,
        trackingNumber: "ANY",
        courier: null,
        status,
        eta: null,
        lastEventAt: occurredAt,
        events: [
          {
            providerEventId: eventId,
            occurredAt,
            status,
            message: null,
            locationText: null,
            courierCode: null,
            order: null,
          },
        ],
      },
    ],
  });
}

const handle = (rawBody: string, headers: Headers, provider = fake) =>
  handleTrackingWebhook({ db: ctx.db, provider, rawBody, headers, now: NOW });

describe("handleTrackingWebhook (fake provider)", () => {
  it("accepts an authentic webhook, stores the checkpoint and updates the status", async () => {
    const row = await addShipment("fake", "fake:A-1");

    const outcome = await handle(
      fakeBody("fake:A-1", "OutForDelivery", "a1-e1", "2026-06-20T09:00:00Z"),
      auth(),
    );

    expect(outcome).toEqual({ status: 200, applied: 1, newCheckpoints: 1 });
    expect((await reload(row.id)).status).toBe("OutForDelivery");
    expect(await eventCount(row.id)).toBe(1);
  });

  it.each([
    ["a missing secret", new Headers()],
    ["a wrong secret", auth("wrong")],
    ["a near-miss secret", auth(`${SECRET}x`)],
    ["a non-bearer scheme", new Headers({ authorization: `Basic ${SECRET}` })],
  ])("rejects %s with 401 and writes nothing", async (_name, headers) => {
    const row = await addShipment("fake", `fake:B-${++seq}`);
    const body = fakeBody(
      row.providerTrackerId!,
      "Delivered",
      "b-e1",
      "2026-06-20T09:00:00Z",
    );

    const outcome = await handle(body, headers);

    expect(outcome).toEqual({ status: 401, applied: 0, newCheckpoints: 0 });
    expect((await reload(row.id)).status).toBe("Pending");
    expect(await eventCount(row.id)).toBe(0);
  });

  it("rejects a tampered body with a valid secret as 422 and writes nothing", async () => {
    const row = await addShipment("fake", "fake:C-1");
    const good = fakeBody(
      "fake:C-1",
      "Delivered",
      "c-e1",
      "2026-06-20T09:00:00Z",
    );

    for (const tampered of [
      "not json",
      "{}",
      good.replace('"Delivered"', '"Teleported"'),
    ]) {
      const outcome = await handle(tampered, auth());
      expect(outcome.status).toBe(422);
    }
    expect((await reload(row.id)).status).toBe("Pending");
    expect(await eventCount(row.id)).toBe(0);
  });

  it("authenticates before reading the body: bad secret plus garbage is 401, not 422", async () => {
    expect((await handle("not json", auth("wrong"))).status).toBe(401);
  });

  it("creates no duplicate checkpoints when the same webhook is delivered twice", async () => {
    const row = await addShipment("fake", "fake:D-1");
    const body = fakeBody(
      "fake:D-1",
      "InTransit",
      "d-e1",
      "2026-06-20T08:00:00Z",
    );

    const first = await handle(body, auth());
    const second = await handle(body, auth());

    expect(first.newCheckpoints).toBe(1);
    expect(second).toEqual({ status: 200, applied: 1, newCheckpoints: 0 });
    expect(await eventCount(row.id)).toBe(1);
  });

  it("keeps the status when an older event arrives late, but still records it", async () => {
    const row = await addShipment("fake", "fake:E-1");

    await handle(
      fakeBody("fake:E-1", "OutForDelivery", "e-new", "2026-06-20T10:00:00Z"),
      auth(),
    );
    const late = await handle(
      fakeBody("fake:E-1", "InTransit", "e-old", "2026-06-19T10:00:00Z"),
      auth(),
    );

    expect(late.status).toBe(200);
    expect((await reload(row.id)).status).toBe("OutForDelivery");
    expect(await eventCount(row.id)).toBe(2);
  });

  it("answers 200 for a tracker nobody follows, so the provider does not retry", async () => {
    const outcome = await handle(
      fakeBody("fake:NOBODY", "InTransit", "n-e1", "2026-06-20T08:00:00Z"),
      auth(),
    );
    expect(outcome).toEqual({ status: 200, applied: 0, newCheckpoints: 0 });
  });

  it("applies the saved fake webhook fixture", async () => {
    const row = await addShipment("fake", "fake:FAKE-TRANSIT-1");
    const outcome = await handle(JSON.stringify(fakeWebhookFixture), auth());
    expect(outcome.status).toBe(200);
    expect((await reload(row.id)).status).toBe("OutForDelivery");
  });

  it("lets a database error escape so the route can answer 500", async () => {
    const broken = {
      transaction: () => Promise.reject(new Error("db down")),
    } as unknown as typeof ctx.db;
    await addShipment("fake", "fake:F-1");

    await expect(
      handleTrackingWebhook({
        db: broken,
        provider: fake,
        rawBody: fakeBody(
          "fake:F-1",
          "InTransit",
          "f-e1",
          "2026-06-20T08:00:00Z",
        ),
        headers: auth(),
        now: NOW,
      }),
    ).rejects.toThrow("db down");
  });
});

describe("handleTrackingWebhook (Ship24 payload)", () => {
  it("applies the saved Ship24 webhook end to end", async () => {
    const row = await addShipment("ship24", SHIP24_TRACKER);

    const outcome = await handle(
      JSON.stringify(ship24WebhookFixture),
      auth(),
      ship24,
    );

    expect(outcome.status).toBe(200);
    expect(outcome.applied).toBeGreaterThanOrEqual(1);
    const reloaded = await reload(row.id);
    expect(reloaded.status).toBe("OutForDelivery");
    // The fixture repeats evt-hook-2: only two distinct events are stored.
    expect(await eventCount(row.id)).toBe(2);
  });

  it("rejects a Ship24 webhook without the secret", async () => {
    const outcome = await handle(
      JSON.stringify(ship24WebhookFixture),
      new Headers(),
      ship24,
    );
    expect(outcome.status).toBe(401);
  });

  it("does not touch a fake-provider shipment that has the same tracker id", async () => {
    const row = await addShipment("fake", SHIP24_TRACKER);
    await handle(JSON.stringify(ship24WebhookFixture), auth(), ship24);
    expect((await reload(row.id)).status).toBe("Pending");
  });
});
