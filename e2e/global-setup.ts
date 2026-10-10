// Before the launch test: the real migrations on a clean database, and the
// map positions of the places the fake package mentions. In production the
// geocoding job fills these in; it does not run in this test.
import { drizzle } from "drizzle-orm/postgres-js";
import { migrate } from "drizzle-orm/postgres-js/migrator";
import postgres from "postgres";
import { e2eDatabaseUrl } from "./env";

/** Places of the fake provider's FAKE-TRANSIT scenario, by their cache key. */
const PLACES = [
  { queryKey: "chicago, il", lat: 41.8781, lng: -87.6298 },
  { queryKey: "memphis, tn", lat: 35.1495, lng: -90.049 },
  { queryKey: "san francisco, ca, us", lat: 37.7749, lng: -122.4194 },
];

export default async function globalSetup(): Promise<void> {
  const sql = postgres(e2eDatabaseUrl(), { max: 1, onnotice: () => {} });
  try {
    await migrate(drizzle(sql), { migrationsFolder: "drizzle" });
    // A clean slate: users cascade to everything of theirs.
    await sql`truncate users, places, rate_limits cascade`;
    for (const place of PLACES) {
      await sql`
        insert into places (query_key, lat, lng, display_name, geocoder)
        values (${place.queryKey}, ${place.lat}, ${place.lng}, ${place.queryKey}, 'e2e')`;
    }
  } finally {
    await sql.end();
  }
}
