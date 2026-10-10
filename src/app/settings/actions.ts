"use server";

import { revalidatePath } from "next/cache";
import { requestEmailRetry } from "@/jobs/events";
import { requireUser } from "@/lib/auth/session";
import { getDb } from "@/lib/db/client";
import { rotateAlias } from "@/lib/db/forwarding";
import { deleteFailedEmail } from "@/lib/db/inbound-emails";
import { saveNotificationPrefs } from "@/lib/db/notification-settings";
import {
  removePushSubscription,
  savePushSubscription,
} from "@/lib/db/push-subscriptions";
import { ensureUser } from "@/lib/db/users";
import { retryFailedEmail } from "@/lib/email/failed";
import { getEnv } from "@/lib/env";
import {
  parseSettingsForm,
  type SettingsFormState,
} from "@/lib/notifications/form";
import { getPushSender } from "@/lib/notifications/senders";
import { pushSubscriptionSchema } from "@/lib/notifications/subscription";
import {
  sendTestPush,
  type TestPushResult,
} from "@/lib/notifications/test-push";

// The user always comes from the verified session, never from form data or an
// argument.

export async function regenerateAddressAction(): Promise<void> {
  const user = await requireUser();
  await rotateAlias(getDb(), user.id);
  revalidatePath("/settings");
}

export async function saveNotificationSettingsAction(
  _previous: SettingsFormState,
  formData: FormData,
): Promise<SettingsFormState> {
  const user = await requireUser();
  const parsed = parseSettingsForm(formData);
  if (!parsed.ok) return { status: "error", message: parsed.message };

  const db = getDb();
  // The settings row references the user row, which may not exist yet.
  await ensureUser(db, user);
  await saveNotificationPrefs(db, user.id, parsed.prefs);
  revalidatePath("/settings");
  return { status: "saved" };
}

/** Stores this browser as a place to send the signed-in user's alerts. */
export async function savePushSubscriptionAction(
  input: unknown,
): Promise<{ ok: boolean }> {
  const user = await requireUser();
  const parsed = pushSubscriptionSchema.safeParse(input);
  if (!parsed.success) return { ok: false };

  const db = getDb();
  await ensureUser(db, user);
  await savePushSubscription(db, user.id, {
    endpoint: parsed.data.endpoint,
    p256dh: parsed.data.keys.p256dh,
    auth: parsed.data.keys.auth,
  });
  revalidatePath("/settings");
  return { ok: true };
}

/** Forgets one of the signed-in user's browsers. Anyone else's is untouched. */
export async function removePushSubscriptionAction(
  endpoint: unknown,
): Promise<void> {
  const user = await requireUser();
  if (typeof endpoint !== "string" || endpoint.length > 2048) return;
  await removePushSubscription(getDb(), user.id, endpoint);
  revalidatePath("/settings");
}

export type FailedEmailState =
  | { status: "idle" }
  | { status: "retried" | "dismissed" | "rate_limited" | "not_found" };

/** Reads one of the user's failed emails again. Only their own, and only a failed one. */
export async function retryEmailAction(
  _previous: FailedEmailState,
  formData: FormData,
): Promise<FailedEmailState> {
  const user = await requireUser();
  const emailId = String(formData.get("emailId") ?? "");
  const now = new Date();
  const result = await retryFailedEmail({
    db: getDb(),
    userId: user.id,
    emailId,
    now,
  });
  if (result === "retried") {
    // Best effort: the hourly sweep picks up a pending email this misses.
    await requestEmailRetry(emailId, now);
    revalidatePath("/settings");
  }
  return { status: result };
}

/** Forgets one of the user's failed emails. Anyone else's is untouched. */
export async function dismissEmailAction(
  _previous: FailedEmailState,
  formData: FormData,
): Promise<FailedEmailState> {
  const user = await requireUser();
  const deleted = await deleteFailedEmail(
    getDb(),
    user.id,
    String(formData.get("emailId") ?? ""),
  );
  if (deleted) revalidatePath("/settings");
  return { status: deleted ? "dismissed" : "not_found" };
}

export async function sendTestPushAction(): Promise<TestPushResult> {
  const user = await requireUser();
  return sendTestPush({
    db: getDb(),
    sender: getPushSender(),
    userId: user.id,
    appUrl: getEnv().APP_URL,
    now: new Date(),
  });
}
