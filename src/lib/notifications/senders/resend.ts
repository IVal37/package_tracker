// Email through Resend's REST API (https://resend.com/docs/api-reference).
// Plain fetch, no SDK.
import { SendError, type EmailMessage, type EmailSender } from "./types";

const ENDPOINT = "https://api.resend.com/emails";
const TIMEOUT_MS = 10_000;

export interface ResendOptions {
  apiKey: string;
  /** The sender address, e.g. "Wayfind <alerts@wayfind.example>"; its domain must be verified in Resend. */
  from: string;
  fetch?: typeof fetch;
}

export class ResendEmailSender implements EmailSender {
  readonly name = "resend";

  constructor(private readonly options: ResendOptions) {}

  /**
   * 429, 409 (Resend's "another request with this key is running") and 5xx are
   * worth a retry, as is a network failure. Any other 4xx (bad key, unverified
   * domain, invalid address) will not change, so it is permanent. The error
   * carries the status only: the body can quote the recipient's address.
   */
  async send(message: EmailMessage): Promise<void> {
    let response: Response;
    try {
      // Looked up per call, not stored: the global fetch can be replaced after
      // this object is built (tests do exactly that).
      response = await (this.options.fetch ?? globalThis.fetch)(ENDPOINT, {
        method: "POST",
        headers: {
          authorization: `Bearer ${this.options.apiKey}`,
          "content-type": "application/json",
          "idempotency-key": message.idempotencyKey,
        },
        body: JSON.stringify({
          from: this.options.from,
          to: [message.to],
          subject: message.subject,
          text: message.text,
          html: message.html,
        }),
        signal: AbortSignal.timeout(TIMEOUT_MS),
      });
    } catch (error) {
      throw new SendError(
        `Email could not be sent (${error instanceof Error ? error.name : "unknown"})`,
        { retryable: true },
      );
    }

    if (!response.ok) {
      const status = response.status;
      throw new SendError(`Email service answered ${status}`, {
        retryable: status === 429 || status === 409 || status >= 500,
        status,
      });
    }
    // Any 2xx means Resend accepted it. The answer (an id) is not used, so it is
    // not parsed: failing on an odd body could cause a duplicate on retry.
  }
}
