import type { Db } from "./client";
import { users } from "./schema";

/**
 * Creates the app user row for a Supabase auth user, or refreshes its email.
 * The id is the Supabase auth user id, so there is exactly one row per account.
 */
export async function ensureUser(
  db: Db,
  user: { id: string; email: string },
): Promise<void> {
  await db
    .insert(users)
    .values({ id: user.id, email: user.email })
    .onConflictDoUpdate({ target: users.id, set: { email: user.email } });
}
