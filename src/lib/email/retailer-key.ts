// Orders are matched on (retailer, order number): order numbers are only unique
// per retailer, and many Shopify stores all start at #1001. The retailer comes
// from the model as a free-text name, so two emails from the same store can
// spell it differently ("Amazon", "Amazon.com", "AMAZON.COM, Inc.").

const FILLER = new Set([
  "the",
  "inc",
  "llc",
  "ltd",
  "co",
  "corp",
  "corporation",
  "company",
  "store",
  "stores",
  "shop",
  "usa",
  "us",
  "official",
]);

/** A comparison key for a retailer name, or null if there is no usable name. */
export function retailerKey(name: string | null): string | null {
  if (!name) return null;

  const lowered = name
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/\.(com|net|org|co\.uk|co|io)\b/g, " ");
  const tokens = lowered.split(/[^a-z0-9]+/).filter(Boolean);

  const meaningful = tokens.filter((token) => !FILLER.has(token));
  // A name made only of filler words ("The Shop") still identifies someone.
  const key = (meaningful.length > 0 ? meaningful : tokens).join("");
  return key.length > 0 ? key : null;
}
