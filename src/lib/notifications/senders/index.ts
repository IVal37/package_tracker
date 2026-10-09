// The only entry point the rest of the app uses to send an alert. The specific
// senders live next to this file and must not be imported from outside
// src/lib/notifications (enforced by ESLint no-restricted-imports).
import { getEnv, type Env } from "@/lib/env";
import { FakeEmailSender, FakePushSender } from "./fake";
import { ResendEmailSender } from "./resend";
import type { EmailSender, PushSender } from "./types";
import { WebPushSender } from "./webpush";

export {
  SendError,
  type EmailMessage,
  type EmailSender,
  type PushPayload,
  type PushResult,
  type PushSender,
  type PushTarget,
} from "./types";

type PushEnv = Pick<
  Env,
  "PUSH_SENDER" | "VAPID_PUBLIC_KEY" | "VAPID_PRIVATE_KEY" | "VAPID_SUBJECT"
>;
type EmailEnv = Pick<Env, "EMAIL_SENDER" | "RESEND_API_KEY" | "EMAIL_FROM">;

/** Pure: builds the push sender an env asks for. */
export function createPushSender(env: PushEnv): PushSender {
  if (env.PUSH_SENDER === "webpush") {
    if (!env.VAPID_PUBLIC_KEY || !env.VAPID_PRIVATE_KEY || !env.VAPID_SUBJECT) {
      throw new Error("Invalid environment: missing VAPID settings");
    }
    return new WebPushSender({
      publicKey: env.VAPID_PUBLIC_KEY,
      privateKey: env.VAPID_PRIVATE_KEY,
      subject: env.VAPID_SUBJECT,
    });
  }
  return new FakePushSender();
}

/** Pure: builds the email sender an env asks for. */
export function createEmailSender(env: EmailEnv): EmailSender {
  if (env.EMAIL_SENDER === "resend") {
    if (!env.RESEND_API_KEY || !env.EMAIL_FROM) {
      throw new Error("Invalid environment: missing Resend settings");
    }
    return new ResendEmailSender({
      apiKey: env.RESEND_API_KEY,
      from: env.EMAIL_FROM,
    });
  }
  return new FakeEmailSender();
}

let cachedPush: PushSender | undefined;
let cachedEmail: EmailSender | undefined;

/** Lazy per-process singleton chosen by PUSH_SENDER. */
export function getPushSender(): PushSender {
  cachedPush ??= createPushSender(getEnv());
  return cachedPush;
}

/** Lazy per-process singleton chosen by EMAIL_SENDER. */
export function getEmailSender(): EmailSender {
  cachedEmail ??= createEmailSender(getEnv());
  return cachedEmail;
}

/** Test helper: drop the cached senders. */
export function resetSenderCache(): void {
  cachedPush = undefined;
  cachedEmail = undefined;
}
