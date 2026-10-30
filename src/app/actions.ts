"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { requestGeocoding } from "@/jobs/events";
import { requireLiveAccount } from "@/lib/auth/account";
import { requireUser } from "@/lib/auth/session";
import { getDb } from "@/lib/db/client";
import { dismissOrder } from "@/lib/db/orders";
import { getEnv } from "@/lib/env";
import { addShipment } from "@/lib/shipments/add-shipment";
import { removeShipment } from "@/lib/shipments/delete-shipment";
import { hitAddPackage, logLimited } from "@/lib/ratelimit";
import { answerSetup } from "@/lib/setup/answer";
import {
  rateLimitedState,
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
  // Checked first, so a refused request costs no provider call at all.
  if (!(await hitAddPackage(db, user.id, new Date())).allowed) {
    logLimited("add-package");
    return rateLimitedState(values);
  }
  // Shipments reference the user row; a session whose row is gone belongs to
  // a deleted account and is signed out instead.
  await requireLiveAccount(db, user);

  const result = await addShipment({
    db,
    provider: getTrackingProvider(),
    userId: user.id,
    input: values,
    activeCap: getEnv().ACTIVE_PACKAGE_CAP,
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

export async function dismissOrderAction(formData: FormData): Promise<void> {
  const user = await requireUser();

  // Only the user's own unshipped orders can be dismissed; anything else is a no-op.
  await dismissOrder(getDb(), user.id, String(formData.get("orderId") ?? ""));

  revalidatePath("/");
}

/** The user says they have finished the first-run setup. */
export async function completeSetupAction(): Promise<void> {
  await answerSetupFor("completed");
}

/**
 * The user skips the first-run setup for now, or marks it as not done. Either
 * way the welcome dialog stays away: it shows only to someone who has never
 * answered.
 */
export async function skipSetupAction(): Promise<void> {
  await answerSetupFor("skipped");
}

async function answerSetupFor(answer: "completed" | "skipped"): Promise<void> {
  const user = await requireUser();
  const db = getDb();
  // The answer lives on the user row; a session whose row is gone belongs to a
  // deleted account and is signed out instead.
  await requireLiveAccount(db, user);

  const result = await answerSetup({
    db,
    userId: user.id,
    answer,
    now: new Date(),
  });
  if (result === "rate_limited") logLimited("setup-answer");

  revalidatePath("/");
  revalidatePath("/setup");
}
