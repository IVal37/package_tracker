// A user's own forwarding alias. Every function takes userId and filters by it.
import { and, eq, isNull } from "drizzle-orm";
import { generateAlias, type RandomBytes } from "@/lib/email/alias";
import type { Db } from "./client";
import { isUniqueViolation } from "./shipments";
import { users } from "./schema";

const MAX_ATTEMPTS = 6;

/**
 * The user's alias, creating one the first time. Returns null if the user does
 * not exist. Two requests racing to create it end up with the same alias.
 */
export async function getOrCreateAlias(
  db: Db,
  userId: string,
  random?: RandomBytes,
): Promise<string | null> {
  const [user] = await db
    .select({ email: users.email, alias: users.forwardingAlias })
    .from(users)
    .where(eq(users.id, userId));
  if (!user) return null;
  if (user.alias) return user.alias;

  for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt++) {
    const alias = generateAlias(user.email, random);
    try {
      const [updated] = await db
        .update(users)
        .set({ forwardingAlias: alias })
        .where(and(eq(users.id, userId), isNull(users.forwardingAlias)))
        .returning({ alias: users.forwardingAlias });
      if (updated?.alias) return updated.alias;

      // Someone else set it between our read and write.
      const [current] = await db
        .select({ alias: users.forwardingAlias })
        .from(users)
        .where(eq(users.id, userId));
      return current?.alias ?? null;
    } catch (error) {
      if (!isUniqueViolation(error)) throw error;
      // Another user has this alias; draw again.
    }
  }
  throw new Error("Could not generate a unique forwarding alias");
}

/** Replaces the alias with a new one; the old address stops working at once. */
export async function rotateAlias(
  db: Db,
  userId: string,
  random?: RandomBytes,
): Promise<string | null> {
  const [user] = await db
    .select({ email: users.email })
    .from(users)
    .where(eq(users.id, userId));
  if (!user) return null;

  for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt++) {
    const alias = generateAlias(user.email, random);
    try {
      const [updated] = await db
        .update(users)
        .set({ forwardingAlias: alias })
        .where(eq(users.id, userId))
        .returning({ alias: users.forwardingAlias });
      return updated?.alias ?? null;
    } catch (error) {
      if (!isUniqueViolation(error)) throw error;
    }
  }
  throw new Error("Could not generate a unique forwarding alias");
}
