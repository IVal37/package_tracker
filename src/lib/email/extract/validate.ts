import { addShipmentSchema } from "@/lib/shipments/validation";
import {
  MAX_TRACKING_NUMBERS,
  extractionSchema,
  type Extraction,
} from "./schema";
import { ExtractionError } from "./types";

/**
 * Checks the model's answer against the strict schema. The error names the
 * fields that failed and never the values: they came from an untrusted email.
 */
export function parseExtraction(raw: unknown): Extraction {
  const parsed = extractionSchema.safeParse(raw);
  if (parsed.success) return parsed.data;

  const fields = [
    ...new Set(
      parsed.error.issues.map((issue) => issue.path.join(".") || "(root)"),
    ),
  ];
  throw new ExtractionError(
    `Extraction failed validation: ${fields.join(", ")}`,
    {
      retryable: false,
    },
  );
}

/** Single-line display text: no control characters, runs of whitespace collapsed. */
export function cleanDisplayText(value: string | null): string | null {
  if (value === null) return null;
  const cleaned = value
    .replace(/[\u0000-\u001f\u007f-\u009f]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  return cleaned.length > 0 ? cleaned : null;
}

export type DropReason = "bad_format" | "not_in_email" | "duplicate";

export interface GroundedTrackingNumber {
  /** Normalized exactly as the Add form would: upper-case, no spaces. */
  trackingNumber: string;
  carrier: string | null;
}

export interface GroundingResult {
  accepted: GroundedTrackingNumber[];
  dropped: { reason: DropReason }[];
}

const SEPARATOR = "[\\s\\-_/.]?";

/** True if the number appears in the haystack, ignoring case, spaces and dashes inside it. */
function appearsIn(trackingNumber: string, haystackUpper: string): boolean {
  const core = [...trackingNumber.replace(/[\s\-_/.]/g, "")];
  if (core.length === 0) return false;
  // Each character is [A-Z0-9], so nothing needs escaping.
  const pattern = new RegExp(
    `(?<![A-Z0-9])${core.join(SEPARATOR)}(?![A-Z0-9])`,
  );
  return pattern.test(haystackUpper);
}

/**
 * Keeps only tracking numbers that (1) pass the same format rule as the Add
 * form and (2) literally appear in the email. A number the model made up, or
 * that an email talked it into producing, is dropped. Duplicates collapse.
 * `source` is everything we hold of the email: subject, text and raw HTML.
 */
export function groundTrackingNumbers(
  entries: Extraction["tracking_numbers"],
  source: string,
): GroundingResult {
  const haystack = source.toUpperCase();
  const accepted: GroundedTrackingNumber[] = [];
  const dropped: GroundingResult["dropped"] = [];
  const seen = new Set<string>();

  for (const entry of entries.slice(0, MAX_TRACKING_NUMBERS)) {
    const checked = addShipmentSchema.shape.trackingNumber.safeParse(
      entry.tracking_number,
    );
    if (!checked.success) {
      dropped.push({ reason: "bad_format" });
      continue;
    }
    if (!appearsIn(checked.data, haystack)) {
      dropped.push({ reason: "not_in_email" });
      continue;
    }
    if (seen.has(checked.data)) {
      dropped.push({ reason: "duplicate" });
      continue;
    }
    seen.add(checked.data);
    accepted.push({
      trackingNumber: checked.data,
      carrier: cleanDisplayText(entry.carrier),
    });
  }
  return { accepted, dropped };
}
