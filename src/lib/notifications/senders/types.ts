// How an alert reaches a person. The delivery job talks to these interfaces
// only; the real services (Web Push, Resend) and the fakes live behind them,
// like the tracking providers and extractors.

export interface PushPayload {
  title: string;
  body: string;
  /** Same-origin URL to open when the notification is tapped. */
  url: string;
  /** Notifications with the same tag replace each other on the device. */
  tag: string;
}

/** One browser or device that agreed to receive push. */
export interface PushTarget {
  endpoint: string;
  p256dh: string;
  auth: string;
}

/**
 * `sent`: handed to the push service. `gone`: the push service says this
 * subscription no longer exists (404 or 410), so the caller should delete it.
 */
export type PushResult = "sent" | "gone";

export interface PushSender {
  readonly name: "fake" | "webpush";
  /** Throws SendError when it cannot deliver for any reason but `gone`. */
  send(target: PushTarget, payload: PushPayload): Promise<PushResult>;
}

export interface EmailMessage {
  to: string;
  subject: string;
  text: string;
  html: string;
  /** Sending twice with the same key sends once (the alert's id). */
  idempotencyKey: string;
}

export interface EmailSender {
  readonly name: "fake" | "resend";
  /** Throws SendError when the email was not accepted. */
  send(message: EmailMessage): Promise<void>;
}

/**
 * A send failed. `retryable` means trying again later may work (rate limit,
 * outage, network); otherwise retrying cannot help (bad address, bad key,
 * payload refused).
 */
export class SendError extends Error {
  readonly retryable: boolean;
  /** HTTP status of the service's answer, when there was one. */
  readonly status: number | null;

  constructor(
    message: string,
    options: { retryable: boolean; status?: number | null },
  ) {
    super(message);
    this.name = "SendError";
    this.retryable = options.retryable;
    this.status = options.status ?? null;
  }
}
