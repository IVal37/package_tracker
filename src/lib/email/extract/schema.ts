import { z } from "zod";

export const EMAIL_TYPES = [
  "order_confirmation",
  "shipping_confirmation",
  "delivery_update",
  "other",
] as const;

export type EmailType = (typeof EMAIL_TYPES)[number];

export const MAX_TRACKING_NUMBERS = 5;

// An empty or blank string from the model means "not there".
const optionalText = (max: number) =>
  z.preprocess(
    (value) =>
      typeof value === "string" && value.trim() === "" ? null : value,
    z.string().trim().min(1).max(max).nullable(),
  );

const trackingEntry = z.strictObject({
  tracking_number: z.string().trim().min(1).max(60),
  carrier: optionalText(40),
});

/**
 * What the model may return. Strict on purpose: an unknown field, a wrong type
 * or an over-long value rejects the whole answer. There is deliberately no
 * field for a user, an address, a URL or an instruction.
 */
export const extractionSchema = z.strictObject({
  email_type: z.enum(EMAIL_TYPES),
  retailer: optionalText(80),
  item: optionalText(120),
  order_number: optionalText(60),
  tracking_numbers: z.array(trackingEntry).max(MAX_TRACKING_NUMBERS),
});

export type Extraction = z.infer<typeof extractionSchema>;

// The same shape without length limits, for the API's structured-output schema:
// the API enforces the structure, and extractionSchema enforces the limits.
const apiSchema = z.strictObject({
  email_type: z.enum(EMAIL_TYPES),
  retailer: z.string().nullable(),
  item: z.string().nullable(),
  order_number: z.string().nullable(),
  tracking_numbers: z.array(
    z.strictObject({
      tracking_number: z.string(),
      carrier: z.string().nullable(),
    }),
  ),
});

export const extractionJsonSchema = z.toJSONSchema(apiSchema) as Record<
  string,
  unknown
>;
