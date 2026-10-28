// The pure part of the Cloudflare Email Worker: turns one received message into
// the JSON body of POST /api/webhooks/inbound-email. It knows nothing about
// Cloudflare or postal-mime (index.ts wires those in), so it is unit tested
// from the app's Vitest run.
//
// It forwards; it does not decide. Unknown addresses, repeats and the daily
// limit are all handled by the app, which answers 200 either way.

/** Cloudflare Email Routing accepts messages up to 25 MiB. Anything bigger is skipped. */
export const MAX_RAW_BYTES = 25 * 1024 * 1024;
/**
 * Longest text or HTML part sent. Must equal MAX_PART_CHARS in
 * src/lib/email/receive.ts (a test checks it), which refuses anything longer.
 */
export const MAX_PART_CHARS = 200_000;
/** The app refuses a request body over 1,000,000 characters (MAX_BODY_CHARS). */
const MAX_BODY_CHARS = 950_000;

/** The parts of Cloudflare's ForwardableEmailMessage this handler uses. */
export interface InboundMessage {
  /** Envelope sender (MAIL FROM). */
  from: string;
  /** Envelope recipient (RCPT TO): our alias, even if the To: header says otherwise. */
  to: string;
  raw: ReadableStream<Uint8Array>;
  rawSize: number;
}

/** What the MIME parser gives back (a subset of postal-mime's Email). */
export interface ParsedMail {
  from?: { name?: string; address?: string };
  subject?: string;
  messageId?: string;
  date?: string;
  text?: string;
  html?: string;
}

export type ParseMail = (
  raw: ReadableStream<Uint8Array>,
) => Promise<ParsedMail>;

export interface HandlerConfig {
  /** Full URL of the app's webhook. */
  endpoint: string;
  secret: string;
  fetch: typeof fetch;
  parse: ParseMail;
}

export type HandlerOutcome =
  /** The app answered 2xx. */
  | "forwarded"
  /** Over 25 MiB: nothing sent. */
  | "skipped_too_large"
  /** The app answered 4xx: retrying would not help. */
  | "dropped";

/**
 * Answers that mean the Worker is pointed at the wrong place or holds the wrong
 * secret (a redirect, 401, 403, 404), not that this email is unacceptable.
 * Dropping the email would lose it for good; throwing makes the sending server
 * try again, so mail sent before the fix is delivered after it.
 */
const isSetupProblem = (status: number) =>
  (status >= 300 && status < 400) ||
  status === 401 ||
  status === 403 ||
  status === 404;

function displayFrom(parsed: ParsedMail, envelopeFrom: string): string {
  const address = parsed.from?.address?.trim();
  if (!address) return envelopeFrom;
  const name = parsed.from?.name?.trim();
  return name ? `${name} <${address}>` : address;
}

/**
 * Parses one message and posts it to the app.
 *
 * Throws when the app answers 5xx or 429 (too many emails to this address just
 * now), cannot be reached, or answers like a wrong setup (a redirect, 401, 403
 * or 404), so Cloudflare tells the sending server to try again later. Any
 * other 4xx is dropped without a retry (the app says the email is not
 * acceptable, and sending it again would not change that).
 * Never logs anything from the message.
 */
export async function handleInboundMessage(
  message: InboundMessage,
  config: HandlerConfig,
): Promise<HandlerOutcome> {
  if (message.rawSize > MAX_RAW_BYTES) return "skipped_too_large";

  const parsed = await config.parse(message.raw);

  const payload = {
    recipient: message.to,
    from: displayFrom(parsed, message.from),
    subject: parsed.subject ?? "",
    messageId: parsed.messageId ?? null,
    date: parsed.date ?? null,
    text: (parsed.text ?? "").slice(0, MAX_PART_CHARS),
    html: (parsed.html ?? "").slice(0, MAX_PART_CHARS),
  };

  let body = JSON.stringify(payload);
  if (body.length > MAX_BODY_CHARS) {
    // Escaping quotes, newlines and control characters can grow a near-limit
    // message past what the app accepts (it would answer 413 and the email
    // would be lost). The text part carries the information: drop the HTML,
    // then trim the text until the body fits.
    let text = payload.text;
    body = JSON.stringify({ ...payload, html: "" });
    while (body.length > MAX_BODY_CHARS) {
      text = text.slice(0, Math.floor(text.length * 0.8));
      body = JSON.stringify({ ...payload, html: "", text });
    }
  }

  const response = await config.fetch(config.endpoint, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      authorization: `Bearer ${config.secret}`,
    },
    body,
    // A redirect to another origin (apex to www, say) is followed without the
    // Authorization header, so the app answers 401 and the email would be lost
    // for a mistake in APP_URL. Not followed: it fails loudly instead.
    redirect: "manual",
  });

  if (isSetupProblem(response.status)) {
    throw new Error(
      `Inbound webhook is not set up right (status ${response.status}): check APP_URL and the secret`,
    );
  }
  if (response.status >= 500 || response.status === 429) {
    throw new Error(`Inbound webhook failed with status ${response.status}`);
  }
  return response.ok ? "forwarded" : "dropped";
}
