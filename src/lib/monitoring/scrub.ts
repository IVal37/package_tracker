// What an error report may contain. Reports leave our servers (to Sentry), so
// everything personal is removed before sending: request bodies, headers,
// cookies, query strings, the user, breadcrumbs, local variables, and any
// email address or tracking-number-like token inside a message. Pure, so it is
// tested with hostile examples.
import type { ErrorEvent } from "@sentry/nextjs";

/** Values allowed in an issue's details: ids, kinds and counts. */
export type DetailValue = string | number | boolean | null;
export type Details = Record<string, DetailValue>;

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
/** A kind, a job id or a reason: lower-case words, never free text. */
const TOKEN = /^[a-z0-9_-]{1,40}$/;
const MAX_KEYS = 20;

/**
 * Keeps only details that cannot carry personal data: numbers, booleans, UUIDs
 * and short lower-case tokens. Anything else (a tracking number, a subject, an
 * address) becomes "[redacted]".
 */
export function sanitizeDetails(details: Details = {}): Details {
  const clean: Details = {};
  for (const [key, value] of Object.entries(details).slice(0, MAX_KEYS)) {
    if (!TOKEN.test(key)) continue;
    if (
      value === null ||
      typeof value === "boolean" ||
      (typeof value === "number" && Number.isFinite(value))
    ) {
      clean[key] = value;
    } else if (
      typeof value === "string" &&
      (UUID.test(value) || TOKEN.test(value))
    ) {
      clean[key] = value;
    } else {
      clean[key] = "[redacted]";
    }
  }
  return clean;
}

const EMAIL = /[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g;
// Postgres "Key (user_id, tracking_number)=(..., 1Z...) already exists".
const PG_KEY_DETAIL = /(Key \([^)]*\))=\([^)]*\)/g;
const QUERY = /(?<=\S)\?[^\s"'<>]+/g;
// 10+ letters and digits with at least one digit, standing alone: tracking
// numbers, phone numbers, codes. UUID segments touch a "-" and are kept.
const TOKENISH = /(?<![\w-])(?=[A-Za-z0-9]*\d)[A-Za-z0-9]{10,}(?![\w-])/g;

/** Removes emails, query strings, key values and long tokens from text. */
export function redactText(text: string): string {
  return text
    .replace(EMAIL, "[email]")
    .replace(PG_KEY_DETAIL, "$1=([redacted])")
    .replace(QUERY, "?[redacted]")
    .replace(TOKENISH, "[redacted]");
}

/** A path with no query string or fragment; "[redacted]" if not a URL. */
function pathOnly(url: string): string {
  try {
    const parsed = new URL(url, "http://placeholder.invalid");
    return parsed.pathname;
  } catch {
    return "[redacted]";
  }
}

/** Contexts Sentry adds about the machine, plus our own sanitized details. */
const KEPT_CONTEXTS = new Set([
  "wayfind",
  "runtime",
  "os",
  "trace",
  "app",
  "device",
  "culture",
]);

/** Sentry's beforeSend: returns the event with everything personal removed. */
export function scrubEvent(event: ErrorEvent): ErrorEvent {
  delete event.user;
  delete event.breadcrumbs;
  delete event.extra;

  if (event.request) {
    event.request = {
      ...(event.request.method && { method: event.request.method }),
      ...(event.request.url && { url: pathOnly(event.request.url) }),
    };
  }
  if (typeof event.message === "string") {
    event.message = redactText(event.message);
  }
  if (event.logentry) {
    // The params are the values formatted into the message: dropped.
    event.logentry = {
      ...(event.logentry.message && {
        message: redactText(event.logentry.message),
      }),
    };
  }
  if (typeof event.transaction === "string") {
    event.transaction = redactText(event.transaction);
  }
  if (event.tags) {
    event.tags = Object.fromEntries(
      Object.entries(event.tags).map(([key, value]) => [
        key,
        typeof value === "string" ? redactText(value) : value,
      ]),
    );
  }
  if (event.contexts) {
    const kept = Object.entries(event.contexts).filter(([key]) =>
      KEPT_CONTEXTS.has(key),
    );
    event.contexts = Object.fromEntries(
      kept.map(([key, value]) => [
        key,
        key === "wayfind" ? sanitizeDetails(value as Details) : value,
      ]),
    ) as ErrorEvent["contexts"];
  }
  for (const exception of event.exception?.values ?? []) {
    if (typeof exception.value === "string") {
      exception.value = redactText(exception.value);
    }
    for (const frame of exception.stacktrace?.frames ?? []) {
      delete frame.vars;
    }
  }
  return event;
}
