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
    TRACKING_PROVIDER: z.enum(["fake", "ship24"]).default("fake"),
    SHIP24_API_KEY: z.string().min(1).optional(),
    SHIP24_WEBHOOK_SECRET: z.string().min(1).optional(),
    FAKE_WEBHOOK_SECRET: z.string().min(1).optional(),
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
  })
  .transform((env) => ({
    ...env,
    FAKE_WEBHOOK_SECRET: env.FAKE_WEBHOOK_SECRET ?? "fake-secret",
  }));

export type Env = z.infer<typeof envSchema>;

export function parseEnv(source: Record<string, string | undefined>): Env {
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
