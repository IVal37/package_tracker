import { vi } from "vitest";

/** The minimum env a valid configuration needs (fake provider, dev mode). */
export const requiredEnv = {
  DATABASE_URL: "postgresql://user:s3cret-pw@db.example.test:6543/postgres",
  SUPABASE_URL: "https://project.supabase.test",
  SUPABASE_PUBLISHABLE_KEY: "sb_publishable_test_key",
};

/** Stubs process.env with the required keys. Pair with vi.unstubAllEnvs(). */
export function stubRequiredEnv(overrides: Record<string, string> = {}) {
  for (const [key, value] of Object.entries({
    ...requiredEnv,
    ...overrides,
  })) {
    vi.stubEnv(key, value);
  }
}
