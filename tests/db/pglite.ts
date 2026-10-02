import { PGlite } from "@electric-sql/pglite";
import { drizzle } from "drizzle-orm/pglite";
import { migrate } from "drizzle-orm/pglite/migrator";
import * as schema from "@/lib/db/schema";

/** A fresh in-memory Postgres with the real migrations applied. */
export async function createTestDb() {
  const client = new PGlite();
  const db = drizzle(client, { schema });
  await migrate(db, { migrationsFolder: "drizzle" });
  return { db, client };
}

let counter = 0;

export async function insertUser(
  db: Awaited<ReturnType<typeof createTestDb>>["db"],
) {
  counter += 1;
  const [user] = await db
    .insert(schema.users)
    .values({ email: `user${counter}@example.test` })
    .returning();
  if (!user) throw new Error("user insert failed");
  return user;
}

export async function insertShipment(
  db: Awaited<ReturnType<typeof createTestDb>>["db"],
  userId: string,
  trackingNumber = `TN${counter++}00000`,
) {
  const [shipment] = await db
    .insert(schema.shipments)
    .values({ userId, trackingNumber, provider: "fake" })
    .returning();
  if (!shipment) throw new Error("shipment insert failed");
  return shipment;
}
