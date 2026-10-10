// Settings for the launch test. The app runs as a production build against a
// test database, the fake tracking provider, fake geocoder and senders, and
// the fake auth server: nothing real is called.

export const APP_PORT = 3100;
export const FAKE_AUTH_PORT = 54399;
export const APP_URL = `http://localhost:${APP_PORT}`;
export const FAKE_AUTH_URL = `http://127.0.0.1:${FAKE_AUTH_PORT}`;

/**
 * The test database: E2E_DATABASE_URL, a local or CI Postgres made for this.
 * Never the Supabase project: global setup empties it.
 */
export function e2eDatabaseUrl(): string {
  const url = process.env.E2E_DATABASE_URL;
  if (!url) {
    throw new Error(
      "Set E2E_DATABASE_URL to a throwaway Postgres (it is wiped). See docs/launch-checklist.md.",
    );
  }
  if (/supabase\.(co|com)/.test(url)) {
    throw new Error("E2E_DATABASE_URL must not be a Supabase database.");
  }
  return url;
}

/**
 * Every setting the app reads, set explicitly. An empty value counts as set,
 * so nothing from a developer's .env.local leaks into the test run.
 */
export function appEnv(): Record<string, string> {
  return {
    NODE_ENV: "production",
    DATABASE_URL: e2eDatabaseUrl(),
    DATABASE_URL_DIRECT: "",
    SUPABASE_URL: FAKE_AUTH_URL,
    SUPABASE_PUBLISHABLE_KEY: "sb_publishable_e2e",
    SUPABASE_SECRET_KEY: "sb_secret_e2e",
    APP_URL,
    TRACKING_PROVIDER: "fake",
    SHIP24_API_KEY: "",
    SHIP24_WEBHOOK_SECRET: "",
    FAKE_WEBHOOK_SECRET: "e2e-webhook-secret",
    INNGEST_SIGNING_KEY: "signkey-e2e-00000000",
    INNGEST_EVENT_KEY: "eventkey-e2e",
    INNGEST_EVENT_API_BASE_URL: `${FAKE_AUTH_URL}/inngest/`,
    INNGEST_BASE_URL: `${FAKE_AUTH_URL}/inngest/`,
    INNGEST_DEV: "",
    GEOCODER: "fake",
    INBOUND_EMAIL_DOMAIN: "in.e2e.test",
    INBOUND_WEBHOOK_SECRET: "e2e-inbound-secret",
    EMAIL_EXTRACTOR: "fake",
    ANTHROPIC_API_KEY: "",
    PUSH_SENDER: "fake",
    VAPID_PUBLIC_KEY: "",
    VAPID_PRIVATE_KEY: "",
    VAPID_SUBJECT: "",
    EMAIL_SENDER: "fake",
    RESEND_API_KEY: "",
    EMAIL_FROM: "",
    SENTRY_DSN: "",
    ADMIN_EMAILS: "",
    SUPPORT_EMAIL: "support@e2e.test",
  };
}
