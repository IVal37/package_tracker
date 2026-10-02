import { z } from "zod";
import { normalizeTrackingNumber } from "@/lib/tracking";

export const addShipmentSchema = z.object({
  // Spaces stripped and uppercased first, then checked against Ship24's rules.
  trackingNumber: z
    .string()
    .transform(normalizeTrackingNumber)
    .pipe(
      z
        .string()
        .min(5, "Tracking numbers are at least 5 characters.")
        .max(50, "Tracking numbers are at most 50 characters.")
        .regex(
          /^[A-Z0-9\-_/.]+$/,
          "Use only letters, numbers and - _ / . characters.",
        ),
    ),
  nickname: z
    .string()
    .trim()
    .max(60, "Nicknames are at most 60 characters.")
    .optional()
    .transform((value) => (value ? value : null)),
});

export type AddShipmentInput = z.input<typeof addShipmentSchema>;
export type ParsedAddShipment = z.output<typeof addShipmentSchema>;

export type FieldErrors = Partial<
  Record<"trackingNumber" | "nickname", string>
>;

/** First message per field, for showing next to the inputs. */
export function toFieldErrors(error: z.ZodError): FieldErrors {
  const errors: FieldErrors = {};
  for (const issue of error.issues) {
    const field = issue.path[0];
    if (
      (field === "trackingNumber" || field === "nickname") &&
      !errors[field]
    ) {
      errors[field] = issue.message;
    }
  }
  return errors;
}
