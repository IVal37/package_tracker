import { sql as sqlTag } from "drizzle-orm";
import type { PgDatabase, PgQueryResultHKT } from "drizzle-orm/pg-core";
import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import { getEnv } from "@/lib/env";
import * as schema from "./schema";

// Shared base type so queries accept both postgres.js (prod) and PGlite (tests).
export type Db = PgDatabase<PgQueryResultHKT, typeof schema>;

export function createDb(url: string, opts: { max?: number } = {}) {
  // prepare: false is required by Supabase's transaction pooler.
  const sql = postgres(url, { prepare: false, max: opts.max ?? 10 });
  const db: Db = drizzle(sql, { schema });
  return { db, sql };
}

export async function checkConnection(db: Db): Promise<void> {
  await db.execute(sqlTag`select 1`);
}

// Keep one pool per process, even across dev hot reloads.
const globalForDb = globalThis as unknown as { __wayfindDb?: Db };

export function getDb(): Db {
  globalForDb.__wayfindDb ??= createDb(getEnv().DATABASE_URL).db;
  return globalForDb.__wayfindDb;
}

/** Test helper: drop the cached connection so getDb() builds a fresh one. */
export function resetDbCache(): void {
  globalForDb.__wayfindDb = undefined;
}
