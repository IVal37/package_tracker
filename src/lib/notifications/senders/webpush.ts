// Web Push through the `web-push` package: VAPID signing and the payload
// encryption are its job (RFC 8030, 8291, 8292).
import webpush from "web-push";
import {
  SendError,
  type PushPayload,
  type PushResult,
  type PushSender,
  type PushTarget,
} from "./types";

/** How long the push service may hold an undelivered alert: a day, then it is stale. */
export const PUSH_TTL_SECONDS = 24 * 60 * 60;
const TIMEOUT_MS = 10_000;

export interface WebPushOptions {
  publicKey: string;
  privateKey: string;
  /** `mailto:` or `https:` contact for the push service. */
  subject: string;
}

/** The one function of `web-push` used; a test can replace it. */
export type SendNotification = typeof webpush.sendNotification;

export class WebPushSender implements PushSender {
  readonly name = "webpush";

  constructor(
    private readonly options: WebPushOptions,
    private readonly sendNotification: SendNotification = webpush.sendNotification.bind(
      webpush,
    ),
  ) {}

  /**
   * 404 and 410 mean the subscription is gone ("gone": the caller deletes it).
   * 429, 5xx and failures with no HTTP answer (network, timeout) are worth a
   * retry. Anything else (a bad VAPID key, a refused payload) will not get
   * better by waiting. Messages carry the status only: an error body can echo
   * the endpoint, which identifies a device.
   */
  async send(target: PushTarget, payload: PushPayload): Promise<PushResult> {
    try {
      await this.sendNotification(
        {
          endpoint: target.endpoint,
          keys: { p256dh: target.p256dh, auth: target.auth },
        },
        JSON.stringify(payload),
        {
          vapidDetails: {
            subject: this.options.subject,
            publicKey: this.options.publicKey,
            privateKey: this.options.privateKey,
          },
          TTL: PUSH_TTL_SECONDS,
          urgency: "normal",
          timeout: TIMEOUT_MS,
        },
      );
      return "sent";
    } catch (error) {
      if (error instanceof webpush.WebPushError) {
        const status = error.statusCode;
        if (status === 404 || status === 410) return "gone";
        throw new SendError(`Push service answered ${status}`, {
          retryable: status === 429 || status >= 500,
          status,
        });
      }
      // Not an HTTP answer: DNS, connection, timeout. Worth trying again.
      throw new SendError(
        `Push could not be sent (${error instanceof Error ? error.name : "unknown"})`,
        { retryable: true },
      );
    }
  }
}
