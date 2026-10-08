import { z } from "zod";

// Only the fields Wayfind reads are declared; zod strips the rest.

const nullableString = z.string().nullish();

export const ship24TrackerSchema = z.object({
  trackerId: z.string().min(1),
  trackingNumber: z.string().min(1),
  isSubscribed: z.boolean().optional(),
});

export const ship24EventSchema = z.object({
  eventId: z.string().min(1),
  status: nullableString,
  occurrenceDatetime: z.string().min(1),
  order: z.number().int().nullish(),
  location: nullableString,
  courierCode: nullableString,
  statusCode: nullableString,
  statusMilestone: z.string(),
});

const ship24DeliverySchema = z.object({
  estimatedDeliveryDate: nullableString,
  courierEstimatedDeliveryDate: z
    .object({ from: nullableString, to: nullableString })
    .nullish(),
});

// Only the non-identifying parts of the recipient; name and street address are
// deliberately not declared, so zod strips them.
const ship24RecipientSchema = z.object({
  city: nullableString,
  subdivision: nullableString,
  postCode: nullableString,
});

export const ship24ShipmentSchema = z.object({
  statusCode: nullableString,
  statusMilestone: z.string(),
  destinationCountryCode: nullableString,
  recipient: ship24RecipientSchema.nullish(),
  delivery: ship24DeliverySchema.nullish(),
});

export const ship24TrackingSchema = z.object({
  tracker: ship24TrackerSchema,
  shipment: ship24ShipmentSchema,
  events: z.array(ship24EventSchema),
});

export type Ship24Tracking = z.infer<typeof ship24TrackingSchema>;

/** Response of /trackers/track, /trackers/{id}/results and /trackers/search/... */
export const ship24TrackingsResponseSchema = z.object({
  data: z.object({ trackings: z.array(ship24TrackingSchema) }),
});

/** Webhook body: trackings at the document root, plus metadata we ignore. */
export const ship24WebhookSchema = z.object({
  trackings: z.array(ship24TrackingSchema),
});

export const ship24ErrorBodySchema = z.object({
  errors: z.array(z.object({ code: z.string(), message: z.string() })),
});
