import { existsSync } from "node:fs";
import { defineConfig } from "drizzle-kit";

// drizzle-kit runs outside Next.js, which is what normally loads .env.local, so
// load it here. Variables already set in the environment (CI) take precedence.
if (existsSync(".env.local")) process.loadEnvFile(".env.local");

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
