// Stand-ins for development and tests. They never touch the network; they
// remember what they were asked to send so a test (or a developer reading the
// log) can see it.
import type {
  EmailMessage,
  EmailSender,
  PushPayload,
  PushResult,
  PushSender,
  PushTarget,
} from "./types";

/** In development only, say that something was "sent" so the flow is visible. */
function announce(what: string, detail: Record<string, unknown>) {
  if (process.env.NODE_ENV === "production") return;
  console.info(`fake ${what} sent`, detail);
}

export class FakePushSender implements PushSender {
  readonly name = "fake";
  readonly sent: { target: PushTarget; payload: PushPayload }[] = [];
  /** Endpoints that answer "gone", as a push service does for a removed subscription. */
  readonly goneEndpoints = new Set<string>();

  async send(target: PushTarget, payload: PushPayload): Promise<PushResult> {
    if (this.goneEndpoints.has(target.endpoint)) return "gone";
    this.sent.push({ target, payload });
    announce("push", { title: payload.title });
    return "sent";
  }
}

export class FakeEmailSender implements EmailSender {
  readonly name = "fake";
  readonly sent: EmailMessage[] = [];
  private readonly keys = new Set<string>();

  async send(message: EmailMessage): Promise<void> {
    // The real service de-duplicates on the key; so does the stand-in.
    if (this.keys.has(message.idempotencyKey)) return;
    this.keys.add(message.idempotencyKey);
    this.sent.push(message);
    announce("email", { subject: message.subject });
  }
}
