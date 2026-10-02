import type { Db } from "@/lib/db/client";
import {
  createShipmentWithCheckpoints,
  findShipmentByTrackingNumber,
  isUniqueViolation,
} from "@/lib/db/shipments";
import {
  InvalidTrackingNumberError,
  TrackingProviderError,
  type TrackingProvider,
} from "@/lib/tracking";
import {
  addShipmentSchema,
  toFieldErrors,
  type AddShipmentInput,
  type FieldErrors,
} from "./validation";

export type AddShipmentResult =
  | { ok: true; shipmentId: string }
  | { ok: false; error: "invalid"; fieldErrors: FieldErrors }
  | { ok: false; error: "duplicate" | "not_found" | "unavailable" };

/**
 * Validates, rejects duplicates for this user, asks the provider to track the
 * number, and stores the shipment with its checkpoints. The provider is never
 * called for invalid input or a duplicate, which saves tracking quota.
 */
export async function addShipment(params: {
  db: Db;
  provider: TrackingProvider;
  userId: string;
  input: AddShipmentInput;
}): Promise<AddShipmentResult> {
  const { db, provider, userId } = params;

  const parsed = addShipmentSchema.safeParse(params.input);
  if (!parsed.success) {
    return {
      ok: false,
      error: "invalid",
      fieldErrors: toFieldErrors(parsed.error),
    };
  }
  const { trackingNumber, nickname } = parsed.data;

  if (await findShipmentByTrackingNumber(db, userId, trackingNumber)) {
    return { ok: false, error: "duplicate" };
  }

  let tracked;
  try {
    tracked = await provider.createTracking({ trackingNumber });
  } catch (error) {
    if (error instanceof InvalidTrackingNumberError) {
      return { ok: false, error: "not_found" };
    }
    if (error instanceof TrackingProviderError) {
      // Auth, quota, rate-limit and outage errors are our problem, not the
      // user's. Log the class only; never the request or any credentials.
      console.error(`[addShipment] provider failure: ${error.name}`);
      return { ok: false, error: "unavailable" };
    }
    throw error;
  }

  try {
    const shipmentId = await createShipmentWithCheckpoints(
      db,
      userId,
      {
        trackingNumber,
        courier: tracked.courier,
        nickname,
        provider: provider.name,
        providerTrackerId: tracked.providerTrackerId,
        status: tracked.status,
        eta: tracked.eta,
        lastEventAt: tracked.lastEventAt,
      },
      tracked.events,
    );
    return { ok: true, shipmentId };
  } catch (error) {
    // Lost a race with a concurrent add of the same number.
    if (isUniqueViolation(error)) return { ok: false, error: "duplicate" };
    throw error;
  }
}
