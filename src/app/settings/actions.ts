"use server";

import { revalidatePath } from "next/cache";
import { requireUser } from "@/lib/auth/session";
import { getDb } from "@/lib/db/client";
import { rotateAlias } from "@/lib/db/forwarding";

// The user always comes from the verified session, never from form data.

export async function regenerateAddressAction(): Promise<void> {
  const user = await requireUser();
  await rotateAlias(getDb(), user.id);
  revalidatePath("/settings");
}
