// Finds carrier tracking numbers in email text by their known formats. The
// result is a list of candidates; the extraction step decides which to use.
// "strong" means the format is specific enough to trust without the model
// (a checksum, a distinctive prefix, or a carrier name right before it).

export type Carrier = "ups" | "usps" | "fedex" | "dhl" | "amazon";

export interface TrackingCandidate {
  /** Upper-case, no spaces. */
  trackingNumber: string;
  carrier: Carrier;
  strong: boolean;
}

/** UPS "1Z" numbers end in a check digit. */
export function isValidUpsNumber(value: string): boolean {
  const number = value.toUpperCase();
  if (!/^1Z[0-9A-Z]{16}$/.test(number)) return false;

  const digits = [...number.slice(2, 17)].map((char) =>
    /\d/.test(char) ? Number(char) : (char.charCodeAt(0) - 63) % 10,
  );
  let odd = 0;
  let even = 0;
  digits.forEach((digit, index) => {
    if (index % 2 === 0) odd += digit;
    else even += digit;
  });
  const check = (10 - ((odd + even * 2) % 10)) % 10;
  return check === Number(number[17]);
}

const NOT_PART_OF_A_WORD = {
  before: "(?<![0-9A-Za-z])",
  after: "(?![0-9A-Za-z])",
};
const { before, after } = NOT_PART_OF_A_WORD;

// Spaces inside a number are common in emails ("1Z 999 AA1 01 2345 6784").
const UPS = new RegExp(
  `${before}1Z[ ]?[0-9A-Z]{3}[ ]?[0-9A-Z]{3}[ ]?[0-9A-Z]{2}[ ]?[0-9A-Z]{4}[ ]?[0-9A-Z]{4}${after}`,
  "gi",
);
// USPS: 20 or 22 digits starting 92, 93, 94 or 95.
const USPS = new RegExp(
  `${before}9[2-5]\\d{2}(?:[ ]?\\d{4}){4}(?:[ ]?\\d{2})?${after}`,
  "g",
);
const AMAZON = new RegExp(`${before}TBA\\d{12}${after}`, "gi");
// Plain digit formats are only trusted with the carrier's name just before.
const FEDEX = new RegExp(`${before}(?:\\d{15}|\\d{12})${after}`, "g");
const DHL = new RegExp(`${before}\\d{10}${after}`, "g");

const CONTEXT_WINDOW = 200;

function mentionsBefore(text: string, index: number, pattern: RegExp): boolean {
  return pattern.test(
    text.slice(Math.max(0, index - CONTEXT_WINDOW), index).toLowerCase(),
  );
}

/** Candidates in order of first appearance, de-duplicated. */
export function findTrackingCandidates(text: string): TrackingCandidate[] {
  const found: (TrackingCandidate & { at: number })[] = [];

  for (const match of text.matchAll(UPS)) {
    const trackingNumber = match[0].replace(/ /g, "").toUpperCase();
    // A 1Z number that fails its checksum is probably a typo or look-alike.
    found.push({
      trackingNumber,
      carrier: "ups",
      strong: isValidUpsNumber(trackingNumber),
      at: match.index,
    });
  }
  for (const match of text.matchAll(USPS)) {
    found.push({
      trackingNumber: match[0].replace(/ /g, ""),
      carrier: "usps",
      strong: true,
      at: match.index,
    });
  }
  for (const match of text.matchAll(AMAZON)) {
    found.push({
      trackingNumber: match[0].toUpperCase(),
      carrier: "amazon",
      strong: true,
      at: match.index,
    });
  }
  for (const match of text.matchAll(FEDEX)) {
    found.push({
      trackingNumber: match[0],
      carrier: "fedex",
      strong: mentionsBefore(text, match.index, /fedex|fed ex/),
      at: match.index,
    });
  }
  for (const match of text.matchAll(DHL)) {
    found.push({
      trackingNumber: match[0],
      carrier: "dhl",
      strong: mentionsBefore(text, match.index, /\bdhl\b/),
      at: match.index,
    });
  }

  found.sort((a, b) => a.at - b.at);
  const seen = new Set<string>();
  const result: TrackingCandidate[] = [];
  for (const { at: _at, ...candidate } of found) {
    if (seen.has(candidate.trackingNumber)) continue;
    seen.add(candidate.trackingNumber);
    result.push(candidate);
  }
  return result;
}
