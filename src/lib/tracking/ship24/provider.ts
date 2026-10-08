import {
  ProviderResponseError,
  TrackerConflictError,
  WebhookAuthError,
} from "../errors";
import { dedupeEvents, parseLogisticsDate } from "../normalize";
import type {
  CreateTrackingInput,
  NormalizedEvent,
  NormalizedShipment,
  TrackingProvider,
} from "../types";
import { verifyBearerSecret } from "../webhook-auth";
import { ship24Request, type Ship24ClientConfig } from "./client";
import { ship24Destination } from "./destination";
import {
  ship24TrackingsResponseSchema,
  ship24WebhookSchema,
  type Ship24Tracking,
} from "./schemas";
import { mapShip24Status } from "./status-map";

export interface Ship24ProviderConfig extends Ship24ClientConfig {
  webhookSecret: string;
}

function toNormalizedEvent(
  event: Ship24Tracking["events"][number],
): NormalizedEvent {
  return {
    providerEventId: event.eventId,
    occurredAt: parseLogisticsDate(event.occurrenceDatetime),
    status: mapShip24Status(event.statusMilestone, event.statusCode),
    message: event.status ?? null,
    locationText: event.location ?? null,
    courierCode: event.courierCode ?? null,
    order: event.order ?? null,
  };
}

function toNormalizedShipment(tracking: Ship24Tracking): NormalizedShipment {
  const events = dedupeEvents(tracking.events.map(toNormalizedEvent));
  const delivery = tracking.shipment.delivery;
  const etaText =
    delivery?.estimatedDeliveryDate ??
    delivery?.courierEstimatedDeliveryDate?.to;

  return {
    providerTrackerId: tracking.tracker.trackerId,
    trackingNumber: tracking.tracker.trackingNumber,
    courier: events.find((e) => e.courierCode)?.courierCode ?? null,
    status: mapShip24Status(
      tracking.shipment.statusMilestone,
      tracking.shipment.statusCode,
    ),
    eta: etaText ? parseLogisticsDate(etaText) : null,
    lastEventAt: events[0]?.occurredAt ?? null,
    destination: ship24Destination(tracking.shipment),
    events,
  };
}

function firstTracking(
  trackings: Ship24Tracking[],
  what: string,
): NormalizedShipment {
  const [first] = trackings;
  if (!first) {
    throw new ProviderResponseError(`Ship24 returned no tracking for ${what}`);
  }
  return toNormalizedShipment(first);
}

export class Ship24Provider implements TrackingProvider {
  readonly name = "ship24";

  constructor(private readonly config: Ship24ProviderConfig) {}

  async createTracking(
    input: CreateTrackingInput,
  ): Promise<NormalizedShipment> {
    try {
      const response = await ship24Request(this.config, {
        method: "POST",
        path: "/public/v1/trackers/track",
        body: {
          trackingNumber: input.trackingNumber,
          ...(input.courierHint && { courierCode: [input.courierHint] }),
          ...(input.destinationPostCode && {
            destinationPostCode: input.destinationPostCode,
          }),
          ...(input.destinationCountryCode && {
            destinationCountryCode: input.destinationCountryCode,
          }),
        },
        schema: ship24TrackingsResponseSchema,
      });
      return firstTracking(response.data.trackings, "this tracking number");
    } catch (error) {
      if (!(error instanceof TrackerConflictError)) throw error;
      // A tracker with these parameters already exists: read it instead.
      const existing = await ship24Request(this.config, {
        method: "GET",
        path: `/public/v1/trackers/search/${encodeURIComponent(input.trackingNumber)}/results`,
        schema: ship24TrackingsResponseSchema,
      });
      return firstTracking(existing.data.trackings, "this tracking number");
    }
  }

  async getTracking(providerTrackerId: string): Promise<NormalizedShipment> {
    const response = await ship24Request(this.config, {
      method: "GET",
      path: `/public/v1/trackers/${encodeURIComponent(providerTrackerId)}/results`,
      schema: ship24TrackingsResponseSchema,
    });
    return firstTracking(response.data.trackings, "this tracker");
  }

  /** Ship24 has no delete endpoint: unsubscribing stops tracking. */
  async deleteTracking(providerTrackerId: string): Promise<void> {
    await ship24Request(this.config, {
      method: "PATCH",
      path: `/public/v1/trackers/${encodeURIComponent(providerTrackerId)}`,
      body: { isSubscribed: false },
    });
  }

  async parseWebhook(
    rawBody: string,
    headers: Headers,
  ): Promise<NormalizedShipment[]> {
    if (!verifyBearerSecret(headers, this.config.webhookSecret)) {
      throw new WebhookAuthError("Webhook authentication failed");
    }

    let json: unknown;
    try {
      json = JSON.parse(rawBody);
    } catch {
      throw new ProviderResponseError("Webhook body is not valid JSON");
    }
    const parsed = ship24WebhookSchema.safeParse(json);
    if (!parsed.success) {
      throw new ProviderResponseError("Webhook body failed validation");
    }
    return parsed.data.trackings.map(toNormalizedShipment);
  }
}
