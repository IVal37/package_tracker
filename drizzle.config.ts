import { defineConfig } from "drizzle-kit";

// drizzle-kit runs outside Next.js, so read process.env directly.
// Migrations use the direct/session URL when set (the pooler can't run DDL reliably).
const url = process.env.DATABASE_URL_DIRECT ?? process.env.DATABASE_URL;
if (!url) {
  throw new Error(
    "Invalid environment: missing DATABASE_URL (or DATABASE_URL_DIRECT)",
  );
}

export default defineConfig({
  dialect: "postgresql",
  schema: "./src/lib/db/schema.ts",
  out: "./drizzle",
  dbCredentials: { url },
});
