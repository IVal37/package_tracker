// @vitest-environment node
import {
  afterAll,
  afterEach,
  beforeAll,
  describe,
  expect,
  it,
  vi,
} from "vitest";
import {
  createShipmentWithCheckpoints,
  getShipmentDetail,
  listShipments,
} from "@/lib/db/shipments";
import {
  InvalidTrackingNumberError,
  ProviderAuthError,
  ProviderResponseError,
  ProviderUnavailableError,
  QuotaExceededError,
  RateLimitedError,
  createTrackingProvider,
  type TrackingProvider,
} from "@/lib/tracking";
import { createTestDb, insertUser } from "../../../tests/db/pglite";
import { addShipment } from "./add-shipment";

let ctx: Awaited<ReturnType<typeof createTestDb>>;

beforeAll(async () => {
  ctx = await createTestDb();
});

afterAll(async () => {
  await ctx.client.close();
});

afterEach(() => {
  vi.restoreAllMocks();
});

const fake = createTrackingProvider({
  TRACKING_PROVIDER: "fake",
  FAKE_WEBHOOK_SECRET: "test-secret",
});

function providerWith(
  createTracking: TrackingProvider["createTracking"],
): TrackingProvider {
  return {
    name: fake.name,
    createTracking,
    getTracking: (id) => fake.getTracking(id),
    deleteTracking: (id) => fake.deleteTracking(id),
    parseWebhook: (body, headers) => fake.parseWebhook(body, headers),
  };
}

const add = async (
  userId: string,
  input: { trackingNumber: string; nickname?: string },
  provider: TrackingProvider = fake,
) => addShipment({ db: ctx.db, provider, userId, input });

describe("addShipment: success", () => {
  it("stores the shipment, its status and its checkpoints", async () => {
    const user = await insertUser(ctx.db);
    const result = await add(user.id, {
      trackingNumber: " fake-ofd-1 ",
      nickname: "  New boots ",
    });

    expect(result.ok).toBe(true);
    if (!result.ok) return;

    const detail = await getShipmentDetail(ctx.db, user.id, result.shipmentId);
    expect(detail?.shipment).toMatchObject({
      trackingNumber: "FAKE-OFD-1",
      nickname: "New boots",
      provider: "fake",
      providerTrackerId: "fake:FAKE-OFD-1",
      status: "OutForDelivery",
      courier: "fake-courier",
    });
    expect(detail?.shipment.eta).toBeInstanceOf(Date);
    expect(detail?.checkpoints).toHaveLength(3);
  });

  it("stores a null nickname when none is given", async () => {
    const user = await insertUser(ctx.db);
    const result = await add(user.id, { trackingNumber: "FAKE-TRANSIT-1" });
    expect(result.ok).toBe(true);
    const [item] = await listShipments(ctx.db, user.id);
    expect(item?.nickname).toBeNull();
  });

  it("allows the same number for a different user", async () => {
    const a = await insertUser(ctx.db);
    const b = await insertUser(ctx.db);
    expect((await add(a.id, { trackingNumber: "FAKE-SHARED-1" })).ok).toBe(
      true,
    );
    expect((await add(b.id, { trackingNumber: "FAKE-SHARED-1" })).ok).toBe(
      true,
    );
  });
});

describe("addShipment: rejections that never reach the provider", () => {
  it("rejects invalid input with field errors", async () => {
    const user = await insertUser(ctx.db);
    const spy = vi.spyOn(fake, "createTracking");

    const result = await add(user.id, { trackingNumber: "abc" });

    expect(result).toEqual({
      ok: false,
      error: "invalid",
      fieldErrors: { trackingNumber: expect.stringMatching(/at least 5/) },
    });
    expect(spy).not.toHaveBeenCalled();
    expect(await listShipments(ctx.db, user.id)).toHaveLength(0);
  });

  it("rejects a duplicate for the same user, after normalization", async () => {
    const user = await insertUser(ctx.db);
    await add(user.id, { trackingNumber: "FAKE-DUP-1" });
    const spy = vi.spyOn(fake, "createTracking");

    const result = await add(user.id, { trackingNumber: " fake-dup-1 " });

    expect(result).toEqual({ ok: false, error: "duplicate" });
    expect(spy).not.toHaveBeenCalled();
    expect(await listShipments(ctx.db, user.id)).toHaveLength(1);
  });
});

describe("addShipment: provider errors", () => {
  it("maps an unknown tracking number to not_found and stores nothing", async () => {
    const user = await insertUser(ctx.db);
    const result = await add(user.id, { trackingNumber: "FAKE-INVALID-1" });
    expect(result).toEqual({ ok: false, error: "not_found" });
    expect(await listShipments(ctx.db, user.id)).toHaveLength(0);
  });

  it.each([
    ["quota", new QuotaExceededError("403")],
    ["rate limit", new RateLimitedError()],
    ["outage", new ProviderUnavailableError()],
    ["auth", new ProviderAuthError("401")],
    ["bad response", new ProviderResponseError("bad")],
  ])(
    "maps a %s error to unavailable and stores nothing",
    async (_label, error) => {
      const errorLog = vi.spyOn(console, "error").mockImplementation(() => {});
      const user = await insertUser(ctx.db);

      const result = await add(
        user.id,
        { trackingNumber: "FAKE-ERR-1" },
        providerWith(() => Promise.reject(error)),
      );

      expect(result).toEqual({ ok: false, error: "unavailable" });
      expect(await listShipments(ctx.db, user.id)).toHaveLength(0);
      expect(errorLog).toHaveBeenCalledWith(
        expect.stringContaining(error.name),
      );
    },
  );

  it("rethrows errors that are not provider errors", async () => {
    const user = await insertUser(ctx.db);
    await expect(
      add(
        user.id,
        { trackingNumber: "FAKE-BUG-1" },
        providerWith(() => Promise.reject(new TypeError("bug"))),
      ),
    ).rejects.toThrow("bug");
  });

  it("returns duplicate when a concurrent add wins the race", async () => {
    const user = await insertUser(ctx.db);
    const racing = providerWith(async (input) => {
      const tracked = await fake.createTracking(input);
      // Another request stores the same number while we await the provider.
      await createShipmentWithCheckpoints(
        ctx.db,
        user.id,
        {
          trackingNumber: tracked.trackingNumber,
          courier: null,
          nickname: null,
          provider: "fake",
          providerTrackerId: tracked.providerTrackerId,
          status: tracked.status,
          eta: null,
          lastEventAt: null,
        },
        [],
      );
      return tracked;
    });

    const result = await add(
      user.id,
      { trackingNumber: "FAKE-RACE-1" },
      racing,
    );

    expect(result).toEqual({ ok: false, error: "duplicate" });
    expect(await listShipments(ctx.db, user.id)).toHaveLength(1);
  });

  it("rethrows unexpected database errors", async () => {
    const user = await insertUser(ctx.db);
    await expect(
      addShipment({
        db: ctx.db,
        provider: fake,
        userId: "not-a-uuid",
        input: { trackingNumber: "FAKE-DBERR-1" },
      }),
    ).rejects.toThrow();
    expect(await listShipments(ctx.db, user.id)).toHaveLength(0);
  });
});

describe("addShipment: unknown provider error class", () => {
  it("treats InvalidTrackingNumberError from any provider as not_found", async () => {
    const user = await insertUser(ctx.db);
    const result = await add(
      user.id,
      { trackingNumber: "ANYTHING-1" },
      providerWith(() => Promise.reject(new InvalidTrackingNumberError("400"))),
    );
    expect(result).toEqual({ ok: false, error: "not_found" });
  });
});
