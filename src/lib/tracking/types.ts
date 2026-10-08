import { z } from "zod";
import { STATUSES } from "./status";

export const normalizedEventSchema = z.object({
  providerEventId: z.string().min(1),
  occurredAt: z.date(),
  status: z.enum(STATUSES),
  message: z.string().nullable(),
  locationText: z.string().nullable(),
  courierCode: z.string().nullable(),
  order: z.number().int().nullable(),
});

export type NormalizedEvent = z.infer<typeof normalizedEventSchema>;

export const normalizedShipmentSchema = z.object({
  providerTrackerId: z.string().min(1),
  trackingNumber: z.string().min(1),
  courier: z.string().nullable(),
  status: z.enum(STATUSES),
  eta: z.date().nullable(),
  lastEventAt: z.date().nullable(),
  // Where it is going, as geocodable text ("SAN RAFAEL, CA, 94901, US"): city,
  // region, postcode and country only, never the recipient's name or street.
  destination: z.string().nullable(),
  // Newest first, de-duplicated by providerEventId.
  events: z.array(normalizedEventSchema),
});

export type NormalizedShipment = z.infer<typeof normalizedShipmentSchema>;

export interface CreateTrackingInput {
  trackingNumber: string;
  courierHint?: string;
  // Some couriers need these to return results.
  destinationPostCode?: string;
  destinationCountryCode?: string;
}

export interface TrackingProvider {
  /** Stored in shipments.provider so each row records which provider created it. */
  readonly name: "ship24" | "fake";
  /** Idempotent: creating the same tracking number twice returns the same tracker. */
  createTracking(input: CreateTrackingInput): Promise<NormalizedShipment>;
  getTracking(providerTrackerId: string): Promise<NormalizedShipment>;
  /** Stops tracking. Providers without a delete endpoint unsubscribe instead. */
  deleteTracking(providerTrackerId: string): Promise<void>;
  /** Authenticates the request first, then parses. Throws WebhookAuthError on failure. */
  parseWebhook(
    rawBody: string,
    headers: Headers,
  ): Promise<NormalizedShipment[]>;
}
