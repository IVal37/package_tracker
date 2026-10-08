// Pure helpers for `npm run eval:email`, which runs emails through the real
// model and counts how many it read correctly. No network here.
import { normalizeTrackingNumber } from "@/lib/tracking/normalize";
import type { EmailType } from "./extract";
import { retailerKey } from "./retailer-key";

/** What a case should produce; the shape of the `model` entries in retailers.json. */
export interface EvalExpectation {
  email_type: EmailType;
  retailer: string | null;
  order_number: string | null;
  tracking_numbers: { tracking_number: string }[];
}

/** What the model produced, after the app's own validation and grounding. */
export interface EvalActual {
  email_type: EmailType;
  retailer: string | null;
  order_number: string | null;
  /** Normalized, and present in the email. */
  trackingNumbers: string[];
}

/**
 * The ways the answer differs from the expectation; empty means correct. The
 * item is not compared: its wording legitimately varies. Retailers compare by
 * their key, so "Amazon" and "Amazon.com" agree.
 */
export function scoreExtraction(
  expected: EvalExpectation,
  actual: EvalActual,
): string[] {
  const differences: string[] = [];

  if (expected.email_type !== actual.email_type) {
    differences.push(
      `email_type: expected ${expected.email_type}, got ${actual.email_type}`,
    );
  }
  if (retailerKey(expected.retailer) !== retailerKey(actual.retailer)) {
    differences.push(
      `retailer: expected ${expected.retailer ?? "none"}, got ${actual.retailer ?? "none"}`,
    );
  }
  if ((expected.order_number ?? null) !== (actual.order_number ?? null)) {
    differences.push(
      `order_number: expected ${expected.order_number ?? "none"}, got ${actual.order_number ?? "none"}`,
    );
  }

  const want = new Set(
    expected.tracking_numbers.map((entry) =>
      normalizeTrackingNumber(entry.tracking_number),
    ),
  );
  const got = new Set(actual.trackingNumbers);
  const missing = [...want].filter((number) => !got.has(number));
  const extra = [...got].filter((number) => !want.has(number));
  if (missing.length > 0) {
    differences.push(`missing tracking numbers: ${missing.join(", ")}`);
  }
  if (extra.length > 0) {
    differences.push(`unexpected tracking numbers: ${extra.join(", ")}`);
  }

  return differences;
}

export interface TextEmail {
  from: string;
  subject: string;
  text: string;
  html: string;
}

const HTML_BODY = /<(?:html|body|table|div|p|a)[\s>]/i;

/**
 * Reads an example email saved as plain text: `From:` and `Subject:` lines,
 * a blank line, then the body. A body that looks like HTML is treated as HTML.
 */
export function parseTextEmail(content: string): TextEmail {
  const lines = content.replace(/\r\n?/g, "\n").split("\n");
  let from = "";
  let subject = "";
  let index = 0;

  for (; index < lines.length; index++) {
    const line = lines[index]!;
    if (line.trim() === "") {
      index += 1;
      break;
    }
    const header = /^(from|subject):\s*(.*)$/i.exec(line);
    if (!header) {
      // Not a header block after all: the whole file is the body.
      index = 0;
      from = "";
      subject = "";
      break;
    }
    if (header[1]!.toLowerCase() === "from") from = header[2]!.trim();
    else subject = header[2]!.trim();
  }

  const body = lines.slice(index).join("\n");
  return HTML_BODY.test(body)
    ? { from, subject, text: "", html: body }
    : { from, subject, text: body, html: "" };
}
