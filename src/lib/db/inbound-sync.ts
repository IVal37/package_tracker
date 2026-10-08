// SYSTEM-SCOPE lookup for the inbound email webhook: it turns the address an
// email was sent to into the user who owns it. No user is signed in at that
// point, so nothing here takes a userId. ESLint lets only src/lib/email and
// src/jobs import this module. It returns a user id and nothing else.
import { eq } from "drizzle-orm";
import type { Db } from "./client";
import { users } from "./schema";

/** The user who owns this forwarding alias, or null. The alias must be lower-case. */
export async function findUserIdByAlias(
  db: Db,
  alias: string,
): Promise<string | null> {
  const [row] = await db
    .select({ id: users.id })
    .from(users)
    .where(eq(users.forwardingAlias, alias));
  return row?.id ?? null;
}
