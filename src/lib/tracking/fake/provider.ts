import {
  InvalidTrackingNumberError,
  ProviderResponseError,
  TrackerNotFoundError,
  WebhookAuthError,
} from "../errors";
import { dedupeEvents, normalizeTrackingNumber } from "../normalize";
import type { Status } from "../status";
import {
  normalizedEventSchema,
  normalizedShipmentSchema,
  type CreateTrackingInput,
  type NormalizedEvent,
  type NormalizedShipment,
  type TrackingProvider,
} from "../types";
import { verifyBearerSecret } from "../webhook-auth";
import { z } from "zod";

export interface FakeProviderConfig {
  webhookSecret: string;
  /** Injected clock so tests get fixed timestamps. */
  now?: () => Date;
}

const COURIER = "fake-courier";
const TRACKER_PREFIX = "fake:";
const HOUR_MS = 3_600_000;

interface EventSpec {
  hoursAgo: number;
  status: Status;
  message: string;
  location: string | null;
}

interface Scenario {
  status: Status;
  /** Hours from creation until the ETA; null for no ETA. */
  etaInHours: number | null;
  /** Geocodable destination text. */
  destination: string;
  /** Newest first. */
  events: EventSpec[];
}

const infoReceived = (hoursAgo: number): EventSpec => ({
  hoursAgo,
  status: "InfoReceived",
  message: "Shipping label created",
  location: null,
});

const SCENARIOS: Record<string, Scenario> = {
  TRANSIT: {
    status: "InTransit",
    etaInHours: 48,
    destination: "SAN FRANCISCO, CA, US",
    events: [
      {
        hoursAgo: 6,
        status: "InTransit",
        message: "Arrived at sorting facility",
        location: "CHICAGO, IL",
      },
      {
        hoursAgo: 30,
        status: "InTransit",
        message: "Departed facility",
        location: "MEMPHIS, TN",
      },
      infoReceived(48),
    ],
  },
  OFD: {
    status: "OutForDelivery",
    etaInHours: 8,
    destination: "SAN FRANCISCO, CA, US",
    events: [
      {
        hoursAgo: 1,
        status: "OutForDelivery",
        message: "Out for delivery",
        location: "SAN FRANCISCO, CA",
      },
      {
        hoursAgo: 12,
        status: "InTransit",
        message: "Arrived at local facility",
        location: "OAKLAND, CA",
      },
      infoReceived(72),
    ],
  },
  DELIVERED: {
    status: "Delivered",
    etaInHours: null,
    destination: "SAN FRANCISCO, CA, US",
    events: [
      {
        hoursAgo: 2,
        status: "Delivered",
        message: "Delivered, left at front door",
        location: "SAN FRANCISCO, CA",
      },
      {
        hoursAgo: 5,
        status: "OutForDelivery",
        message: "Out for delivery",
        location: "SAN FRANCISCO, CA",
      },
      {
        hoursAgo: 48,
        status: "InTransit",
        message: "Arrived at local facility",
        location: "OAKLAND, CA",
      },
      {
        hoursAgo: 96,
        status: "InTransit",
        message: "Departed facility",
        location: "MEMPHIS, TN",
      },
      infoReceived(120),
    ],
  },
  EXCEPTION: {
    status: "Exception",
    etaInHours: null,
    destination: "DENVER, CO, US",
    events: [
      {
        hoursAgo: 4,
        status: "Exception",
        message: "Delivery exception: address issue",
        location: "DENVER, CO",
      },
      {
        hoursAgo: 48,
        status: "InTransit",
        message: "Departed facility",
        location: "DENVER, CO",
      },
      infoReceived(72),
    ],
  },
  // No events, but a destination: the map shows a destination pin.
  PENDING: {
    status: "Pending",
    etaInHours: null,
    destination: "PORTLAND, OR, US",
    events: [],
  },
  // Airport wording gives inferMode() something to match.
  AIR: {
    status: "InTransit",
    etaInHours: 72,
    destination: "SAN DIEGO, CA, US",
    events: [
      {
        hoursAgo: 6,
        status: "InTransit",
        message: "Customs cleared, in transit to destination",
        location: "LOS ANGELES, CA",
      },
      {
        hoursAgo: 30,
        status: "InTransit",
        message: "Arrived at air gateway",
        location: "LOS ANGELES INTERNATIONAL AIRPORT, CA",
      },
      {
        hoursAgo: 50,
        status: "InTransit",
        message: "Departed origin airport",
        location: "SHENZHEN BAOAN INTERNATIONAL AIRPORT, CN",
      },
      infoReceived(72),
    ],
  },
};

function scenarioFor(trackingNumber: string): Scenario {
  const match = /^FAKE-([A-Z]+)-/.exec(trackingNumber);
  const key = match?.[1];
  return (key && SCENARIOS[key]) || SCENARIOS.TRANSIT!;
}

// Wire format for fake webhook bodies: a NormalizedShipment with ISO dates.
const fakeWebhookSchema = z.object({
  trackings: z.array(
    normalizedShipmentSchema.extend({
      eta: z.coerce.date().nullable(),
      lastEventAt: z.coerce.date().nullable(),
      destination: z.string().nullable().default(null),
      events: z.array(
        normalizedEventSchema.extend({ occurredAt: z.coerce.date() }),
      ),
    }),
  ),
});

/**
 * In-memory provider for local development and tests. The tracking-number
 * prefix picks a canned scenario (FAKE-TRANSIT-*, FAKE-OFD-*, FAKE-DELIVERED-*,
 * FAKE-EXCEPTION-*, FAKE-PENDING-*, FAKE-AIR-*, FAKE-INVALID-*); anything else
 * is in transit. Never calls the network.
 */
export class FakeProvider implements TrackingProvider {
  readonly name = "fake";
  private readonly now: () => Date;
  private readonly createdAt = new Map<string, Date>();

  constructor(private readonly config: FakeProviderConfig) {
    this.now = config.now ?? (() => new Date());
  }

  async createTracking(
    input: CreateTrackingInput,
  ): Promise<NormalizedShipment> {
    const trackingNumber = normalizeTrackingNumber(input.trackingNumber);
    if (trackingNumber.startsWith("FAKE-INVALID-")) {
      throw new InvalidTrackingNumberError("Fake provider: invalid number");
    }
    return this.build(trackingNumber);
  }

  async getTracking(providerTrackerId: string): Promise<NormalizedShipment> {
    if (!providerTrackerId.startsWith(TRACKER_PREFIX)) {
      throw new TrackerNotFoundError("Fake provider: unknown tracker");
    }
    return this.build(providerTrackerId.slice(TRACKER_PREFIX.length));
  }

  async deleteTracking(providerTrackerId: string): Promise<void> {
    if (!providerTrackerId.startsWith(TRACKER_PREFIX)) {
      throw new TrackerNotFoundError("Fake provider: unknown tracker");
    }
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
    const parsed = fakeWebhookSchema.safeParse(json);
    if (!parsed.success) {
      throw new ProviderResponseError("Webhook body failed validation");
    }
    return parsed.data.trackings.map((tracking) => ({
      ...tracking,
      events: dedupeEvents(tracking.events),
    }));
  }

  private build(trackingNumber: string): NormalizedShipment {
    // Fixed per tracking number so repeated calls return identical data.
    let created = this.createdAt.get(trackingNumber);
    if (!created) {
      created = this.now();
      this.createdAt.set(trackingNumber, created);
    }

    const providerTrackerId = `${TRACKER_PREFIX}${trackingNumber}`;
    const scenario = scenarioFor(trackingNumber);
    const events: NormalizedEvent[] = scenario.events.map((spec, index) => ({
      providerEventId: `${providerTrackerId}-e${scenario.events.length - index}`,
      occurredAt: new Date(created.getTime() - spec.hoursAgo * HOUR_MS),
      status: spec.status,
      message: spec.message,
      locationText: spec.location,
      courierCode: COURIER,
      order: null,
    }));

    return {
      providerTrackerId,
      trackingNumber,
      courier: events.length > 0 ? COURIER : null,
      status: scenario.status,
      eta:
        scenario.etaInHours === null
          ? null
          : new Date(created.getTime() + scenario.etaInHours * HOUR_MS),
      lastEventAt: events[0]?.occurredAt ?? null,
      destination: scenario.destination,
      events,
    };
  }
}
