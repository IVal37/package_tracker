import type { ZodType } from "zod";
import { verifyBearerSecret } from "@/lib/auth/bearer";
import { ProviderResponseError, WebhookAuthError } from "./errors";

/**
 * The first step of a provider's parseWebhook: authenticates the request, then
 * reads the raw body as JSON and validates it. Authentication comes first, so
 * an unauthenticated caller learns nothing about what a valid body looks like.
 */
export function readWebhookBody<T>(
  rawBody: string,
  headers: Headers,
  secret: string,
  schema: ZodType<T>,
): T {
  if (!verifyBearerSecret(headers, secret)) {
    throw new WebhookAuthError("Webhook authentication failed");
  }

  let json: unknown;
  try {
    json = JSON.parse(rawBody);
  } catch {
    throw new ProviderResponseError("Webhook body is not valid JSON");
  }
  const parsed = schema.safeParse(json);
  if (!parsed.success) {
    throw new ProviderResponseError("Webhook body failed validation");
  }
  return parsed.data;
}
