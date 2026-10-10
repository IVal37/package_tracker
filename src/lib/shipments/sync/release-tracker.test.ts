// @vitest-environment node
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { shipments } from "@/lib/db/schema";
import {
  ProviderUnavailableError,
  TrackerNotFoundError,
  createTrackingProvider,
} from "@/lib/tracking";
import { createTestDb, insertUser } from "../../../../tests/db/pglite";
import { releaseTracker } from "./release-tracker";

let ctx: Awaited<ReturnType<typeof createTestDb>>;

beforeAll(async () => {
  ctx = await createTestDb();
});

afterAll(async () => {
  await ctx.client.close();
});

const provider = () =>
  createTrackingProvider({
    TRACKING_PROVIDER: "fake",
    FAKE_WEBHOOK_SECRET: "s",
  });

async function follow(
  userId: string,
  trackerId: string,
  providerName = "fake",
) {
  await ctx.db.insert(shipments).values({
    userId,
    trackingNumber: "RELEASE123",
    provider: providerName,
    providerTrackerId: trackerId,
  });
}

const release = (
  fake: ReturnType<typeof provider>,
  trackerId: string,
  userId: string,
) => releaseTracker({ db: ctx.db, provider: fake, trackerId, userId });

describe("releaseTracker", () => {
  it("unsubscribes a tracker only this user follows", async () => {
    const user = await insertUser(ctx.db);
    await follow(user.id, "fake:ONLY-ME");
    const fake = provider();
    const spy = vi.spyOn(fake, "deleteTracking");

    expect(await release(fake, "fake:ONLY-ME", user.id)).toBe("unsubscribed");
    expect(spy).toHaveBeenCalledExactlyOnceWith("fake:ONLY-ME");
  });

  it("leaves a tracker another user follows", async () => {
    const me = await insertUser(ctx.db);
    const other = await insertUser(ctx.db);
    await follow(me.id, "fake:SHARED");
    await follow(other.id, "fake:SHARED");
    const fake = provider();
    const spy = vi.spyOn(fake, "deleteTracking");

    expect(await release(fake, "fake:SHARED", me.id)).toBe("shared");
    expect(spy).not.toHaveBeenCalled();
  });

  it("does not count the same tracker id under another provider", async () => {
    const me = await insertUser(ctx.db);
    const other = await insertUser(ctx.db);
    await follow(me.id, "fake:CROSS");
    await follow(other.id, "fake:CROSS", "ship24");
    const fake = provider();
    const spy = vi.spyOn(fake, "deleteTracking");

    expect(await release(fake, "fake:CROSS", me.id)).toBe("unsubscribed");
    expect(spy).toHaveBeenCalledOnce();
  });

  it("reports a provider failure without throwing, and logs the class only", async () => {
    const user = await insertUser(ctx.db);
    await follow(user.id, "fake:DOWN");
    const fake = provider();
    vi.spyOn(fake, "deleteTracking").mockRejectedValue(
      new ProviderUnavailableError(),
    );
    const log = vi.spyOn(console, "error").mockImplementation(() => {});

    expect(await release(fake, "fake:DOWN", user.id)).toBe("failed");
    expect(log).toHaveBeenCalledWith(
      "[releaseTracker] provider failure: ProviderUnavailableError",
    );
    log.mockRestore();
  });

  it("treats a tracker the provider no longer knows as gone", async () => {
    const user = await insertUser(ctx.db);
    await follow(user.id, "fake:GONE");
    const fake = provider();
    vi.spyOn(fake, "deleteTracking").mockRejectedValue(
      new TrackerNotFoundError("404"),
    );
    expect(await release(fake, "fake:GONE", user.id)).toBe("gone");
  });
});
