// Server-only. Never export NEXT_PUBLIC_* keys from here and never import
// this module from client components: values must not reach the browser.
import { z } from "zod";

const envSchema = z
  .object({
    DATABASE_URL: z.url(),
    DATABASE_URL_DIRECT: z.url().optional(),
    NODE_ENV: z
      .enum(["development", "test", "production"])
      .default("development"),
    // Supabase Auth. All auth calls happen on the server, so these are plain
    // server-only keys, never NEXT_PUBLIC_*.
    SUPABASE_URL: z.url(),
    SUPABASE_PUBLISHABLE_KEY: z.string().min(1),
    // Public origin of this app; used to build auth redirect URLs.
    APP_URL: z.url().default("http://localhost:3000"),
    TRACKING_PROVIDER: z.enum(["fake", "ship24"]).default("fake"),
    SHIP24_API_KEY: z.string().min(1).optional(),
    SHIP24_WEBHOOK_SECRET: z.string().min(1).optional(),
    FAKE_WEBHOOK_SECRET: z.string().min(1).optional(),
    // Inngest verifies its calls to /api/inngest with this. The SDK reads it
    // from the environment itself; it is listed here so a production deploy
    // without it fails loudly. Optional in development (INNGEST_DEV=1).
    INNGEST_SIGNING_KEY: z.string().min(1).optional(),
    // Needed to send events (geocoding requests). Same rules as the signing key.
    INNGEST_EVENT_KEY: z.string().min(1).optional(),
    // "fake" never touches the network; "nominatim" is OpenStreetMap's public
    // geocoder (light use only, see docs/phase-4-plan.md).
    GEOCODER: z.enum(["fake", "nominatim"]).default("fake"),
  })
  .superRefine((env, ctx) => {
    const require = (key: keyof typeof env) =>
      ctx.addIssue({ code: "custom", path: [key], message: "required" });

    if (env.TRACKING_PROVIDER === "ship24") {
      if (!env.SHIP24_API_KEY) require("SHIP24_API_KEY");
      if (!env.SHIP24_WEBHOOK_SECRET) require("SHIP24_WEBHOOK_SECRET");
    }
    // The fake provider's well-known default secret is for development only.
    if (
      env.TRACKING_PROVIDER === "fake" &&
      env.NODE_ENV === "production" &&
      !env.FAKE_WEBHOOK_SECRET
    ) {
      require("FAKE_WEBHOOK_SECRET");
    }
    if (env.NODE_ENV === "production" && !env.INNGEST_SIGNING_KEY) {
      require("INNGEST_SIGNING_KEY");
    }
    if (env.NODE_ENV === "production" && !env.INNGEST_EVENT_KEY) {
      require("INNGEST_EVENT_KEY");
    }
  })
  .transform((env) => ({
    ...env,
    FAKE_WEBHOOK_SECRET: env.FAKE_WEBHOOK_SECRET ?? "fake-secret",
  }));

export type Env = z.infer<typeof envSchema>;

export function parseEnv(rawSource: Record<string, string | undefined>): Env {
  // A blank line like `SHIP24_API_KEY=` in a .env file means "not set".
  const source = Object.fromEntries(
    Object.entries(rawSource).filter(([, value]) => value !== ""),
  );
  const result = envSchema.safeParse(source);
  if (result.success) return result.data;

  // Report key names only. Values may be secrets and must never be logged.
  const problems = [
    ...new Set(
      result.error.issues.map((issue) => {
        const key = issue.path.join(".");
        return source[key] === undefined ? `missing ${key}` : `invalid ${key}`;
      }),
    ),
  ];
  throw new Error(`Invalid environment: ${problems.join("; ")}`);
}

let cached: Env | undefined;

export function getEnv(): Env {
  cached ??= parseEnv(process.env);
  return cached;
}

/** Test helper: forget the cached env so the next getEnv() re-reads process.env. */
export function resetEnvCache(): void {
  cached = undefined;
}
