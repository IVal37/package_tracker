"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { requestGeocoding } from "@/jobs/events";
import { requireUser } from "@/lib/auth/session";
import { getDb } from "@/lib/db/client";
import { ensureUser } from "@/lib/db/users";
import { addShipment } from "@/lib/shipments/add-shipment";
import { removeShipment } from "@/lib/shipments/delete-shipment";
import {
  toAddPackageState,
  type AddPackageState,
} from "@/lib/shipments/form-state";
import { getTrackingProvider } from "@/lib/tracking";

// These actions only parse input and call lib code. The user always comes from
// the verified session, never from form data.

export async function addPackageAction(
  _previous: AddPackageState,
  formData: FormData,
): Promise<AddPackageState> {
  const user = await requireUser();
  const values = {
    trackingNumber: String(formData.get("trackingNumber") ?? ""),
    nickname: String(formData.get("nickname") ?? ""),
  };

  const db = getDb();
  // Cheap upsert so a valid session always has the row shipments reference.
  await ensureUser(db, user);

  const result = await addShipment({
    db,
    provider: getTrackingProvider(),
    userId: user.id,
    input: values,
  });
  if (result.ok) {
    revalidatePath("/");
    // The new package's places need coordinates for the map. Best effort.
    await requestGeocoding();
  }
  return toAddPackageState(result, values);
}

export async function deletePackageAction(formData: FormData): Promise<void> {
  const user = await requireUser();

  await removeShipment({
    db: getDb(),
    provider: getTrackingProvider(),
    userId: user.id,
    shipmentId: String(formData.get("shipmentId") ?? ""),
  });

  revalidatePath("/");
  redirect("/");
}
