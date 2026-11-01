import { requireLiveAccount } from "@/lib/auth/account";
import type { CurrentUser } from "@/lib/auth/session";
import type { Db } from "@/lib/db/client";
import { getOrCreateAlias } from "@/lib/db/forwarding";
import { getEnv } from "@/lib/env";
import { formatAddress } from "./alias";

/**
 * The signed-in user's forwarding address, or null if it could not be made.
 * The alias hangs off the user row. If the account was deleted on another
 * device, this session is signed out rather than given a new row.
 */
export async function loadForwardingAddress(
  db: Db,
  user: CurrentUser,
): Promise<string | null> {
  await requireLiveAccount(db, user);
  const alias = await getOrCreateAlias(db, user.id);
  return alias ? formatAddress(alias, getEnv().INBOUND_EMAIL_DOMAIN) : null;
}
