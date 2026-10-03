import type { AddShipmentResult } from "./add-shipment";
import type { FieldErrors } from "./validation";

export interface AddPackageValues {
  trackingNumber: string;
  nickname: string;
}

export type AddPackageState =
  | { status: "idle" }
  | { status: "success" }
  | {
      status: "error";
      error: "invalid" | "duplicate" | "not_found" | "unavailable";
      fieldErrors: FieldErrors;
      /** Echoed back so the form keeps what the user typed. */
      values: AddPackageValues;
    };

export const ADD_PACKAGE_MESSAGES = {
  duplicate: "You're already tracking this package.",
  not_found: "We couldn't find that tracking number. Check it and try again.",
  unavailable: "Tracking is temporarily unavailable. Please try again soon.",
} as const;

export function toAddPackageState(
  result: AddShipmentResult,
  values: AddPackageValues,
): AddPackageState {
  if (result.ok) return { status: "success" };
  return {
    status: "error",
    error: result.error,
    fieldErrors: result.error === "invalid" ? result.fieldErrors : {},
    values,
  };
}
