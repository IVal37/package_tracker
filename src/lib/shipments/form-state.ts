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
      error: Exclude<AddShipmentResult, { ok: true }>["error"] | "rate_limited";
      fieldErrors: FieldErrors;
      /** Echoed back so the form keeps what the user typed. */
      values: AddPackageValues;
    };

export const ADD_PACKAGE_MESSAGES = {
  duplicate: "You're already tracking this package.",
  not_found: "We couldn't find that tracking number. Check it and try again.",
  unavailable: "Tracking is temporarily unavailable. Please try again soon.",
  limit_reached:
    "You're following as many packages as you can at once. Delete one, or wait for one to be delivered.",
  rate_limited:
    "You're adding packages very quickly. Wait a minute and try again.",
} as const;

/** The form's answer when the add limit refused the request. */
export function rateLimitedState(values: AddPackageValues): AddPackageState {
  return { status: "error", error: "rate_limited", fieldErrors: {}, values };
}

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
