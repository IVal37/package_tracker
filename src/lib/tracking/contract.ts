import { beforeEach, describe, expect, it } from "vitest";
import {
  InvalidTrackingNumberError,
  TrackerNotFoundError,
  WebhookAuthError,
} from "./errors";
import {
  normalizedShipmentSchema,
  type NormalizedShipment,
  type TrackingProvider,
} from "./types";

export interface ContractSetup {
  provider: TrackingProvider;
  /** The value of provider.name, stored in shipments.provider. */
  providerName: TrackingProvider["name"];
  validNumber: string;
  invalidNumber: string;
  unknownTrackerId: string;
  webhook: {
    /** A body that contains at least one repeated event id. */
    body: string;
    validHeaders: Headers;
    invalidHeaders: Headers;
  };
}

function expectNewestFirstAndUnique(shipment: NormalizedShipment) {
  const ids = shipment.events.map((e) => e.providerEventId);
  expect(new Set(ids).size).toBe(ids.length);

  const times = shipment.events.map((e) => e.occurredAt.getTime());
  expect(times).toEqual([...times].sort((a, b) => b - a));
}

/**
 * One behavioural suite that every TrackingProvider must pass. `setup` runs
 * before each test and returns a fresh provider plus the inputs it understands.
 */
export function runProviderContract(
  name: string,
  setup: () => ContractSetup | Promise<ContractSetup>,
) {
  describe(`TrackingProvider contract: ${name}`, () => {
    let ctx: ContractSetup;

    beforeEach(async () => {
      ctx = await setup();
    });

    it("exposes its provider name", () => {
      expect(ctx.provider.name).toBe(ctx.providerName);
    });

    it("createTracking returns a valid, newest-first NormalizedShipment", async () => {
      const shipment = await ctx.provider.createTracking({
        trackingNumber: ctx.validNumber,
      });

      expect(normalizedShipmentSchema.safeParse(shipment).success).toBe(true);
      expect(shipment.providerTrackerId).not.toBe("");
      expectNewestFirstAndUnique(shipment);
      expect(shipment.lastEventAt).toEqual(
        shipment.events[0]?.occurredAt ?? null,
      );
    });

    it("createTracking is idempotent for the same tracking number", async () => {
      const first = await ctx.provider.createTracking({
        trackingNumber: ctx.validNumber,
      });
      const second = await ctx.provider.createTracking({
        trackingNumber: ctx.validNumber,
      });
      expect(second.providerTrackerId).toBe(first.providerTrackerId);
    });

    it("getTracking returns what createTracking returned", async () => {
      const created = await ctx.provider.createTracking({
        trackingNumber: ctx.validNumber,
      });
      const fetched = await ctx.provider.getTracking(created.providerTrackerId);
      expect(fetched).toEqual(created);
    });

    it("getTracking throws TrackerNotFoundError for an unknown tracker", async () => {
      await expect(
        ctx.provider.getTracking(ctx.unknownTrackerId),
      ).rejects.toBeInstanceOf(TrackerNotFoundError);
    });

    it("createTracking throws InvalidTrackingNumberError for a bad number", async () => {
      await expect(
        ctx.provider.createTracking({ trackingNumber: ctx.invalidNumber }),
      ).rejects.toBeInstanceOf(InvalidTrackingNumberError);
    });

    it("deleteTracking resolves for an existing tracker", async () => {
      const created = await ctx.provider.createTracking({
        trackingNumber: ctx.validNumber,
      });
      await expect(
        ctx.provider.deleteTracking(created.providerTrackerId),
      ).resolves.toBeUndefined();
    });

    it("deleteTracking throws TrackerNotFoundError for an unknown tracker", async () => {
      await expect(
        ctx.provider.deleteTracking(ctx.unknownTrackerId),
      ).rejects.toBeInstanceOf(TrackerNotFoundError);
    });

    it("parseWebhook accepts valid auth and returns de-duplicated shipments", async () => {
      const shipments = await ctx.provider.parseWebhook(
        ctx.webhook.body,
        ctx.webhook.validHeaders,
      );

      expect(shipments.length).toBeGreaterThan(0);
      for (const shipment of shipments) {
        expect(normalizedShipmentSchema.safeParse(shipment).success).toBe(true);
        expectNewestFirstAndUnique(shipment);
      }
    });

    it("parseWebhook throws WebhookAuthError for wrong auth", async () => {
      await expect(
        ctx.provider.parseWebhook(ctx.webhook.body, ctx.webhook.invalidHeaders),
      ).rejects.toBeInstanceOf(WebhookAuthError);
    });

    it("parseWebhook throws WebhookAuthError when the Authorization header is missing", async () => {
      await expect(
        ctx.provider.parseWebhook(ctx.webhook.body, new Headers()),
      ).rejects.toBeInstanceOf(WebhookAuthError);
    });
  });
}
