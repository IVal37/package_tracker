// The ONLY module that uses SUPABASE_SECRET_KEY. That key bypasses every rule
// in Supabase, so it is used for one thing: deleting a sign-in account when
// its owner deletes their Wayfind account. ESLint lets only src/lib/privacy
// import this module. Server-only; the key never reaches the browser.
import { createClient } from "@supabase/supabase-js";
import { getEnv } from "@/lib/env";

export interface AuthAdmin {
  /** Deletes the sign-in account. Throws if Supabase refuses or fails. */
  deleteUser(userId: string): Promise<void>;
}

/** Thrown when the sign-in account could not be deleted. Carries no details. */
export class AuthAdminError extends Error {
  constructor(readonly status: number | null) {
    super(`Could not delete the sign-in account (${status ?? "no status"})`);
    this.name = "AuthAdminError";
  }
}

/** Pure: an AuthAdmin for these settings. */
export function createAuthAdmin(options: {
  url: string;
  secretKey: string;
  fetch?: typeof fetch;
}): AuthAdmin {
  const client = createClient(options.url, options.secretKey, {
    auth: { persistSession: false, autoRefreshToken: false },
    ...(options.fetch && { global: { fetch: options.fetch } }),
  });
  return {
    async deleteUser(userId) {
      const { error } = await client.auth.admin.deleteUser(userId);
      if (error) {
        const status =
          "status" in error && typeof error.status === "number"
            ? error.status
            : null;
        // A user already gone is the outcome we wanted.
        if (status === 404) return;
        throw new AuthAdminError(status);
      }
    },
  };
}

/** The configured AuthAdmin, or null when SUPABASE_SECRET_KEY is not set. */
export function getAuthAdmin(): AuthAdmin | null {
  const env = getEnv();
  if (!env.SUPABASE_SECRET_KEY) return null;
  return createAuthAdmin({
    url: env.SUPABASE_URL,
    secretKey: env.SUPABASE_SECRET_KEY,
  });
}
