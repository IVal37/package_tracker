import { findTrackingCandidates } from "../tracking-patterns";
import type { Extraction, EmailType } from "./schema";
import type { ExtractionInput, Extractor } from "./types";

const SHIPPED =
  /\b(has shipped|have shipped|is on its way|on the way|shipment confirmation|shipping confirmation|tracking number|track your package)\b/i;
const ORDERED =
  /\b(order confirmation|thanks for your order|thank you for your order|we(?:'ve| have)? received your order|order received|order placed)\b/i;
const DELIVERED =
  /\b(delivered|out for delivery|delivery update|delivery attempt)\b/i;

function classify(subject: string, text: string): EmailType {
  const haystack = `${subject}\n${text}`;
  if (DELIVERED.test(subject)) return "delivery_update";
  if (SHIPPED.test(haystack)) return "shipping_confirmation";
  if (ORDERED.test(haystack)) return "order_confirmation";
  if (DELIVERED.test(haystack)) return "delivery_update";
  return "other";
}

/** "Amazon.com <ship@amazon.com>" -> "Amazon.com"; "orders@store.example" -> "Store". */
function retailerFrom(from: string): string | null {
  const name = /^\s*"?([^"<]+?)"?\s*</.exec(from)?.[1]?.trim();
  if (name && !name.includes("@")) return name.slice(0, 80);

  const domain = /@([a-z0-9.-]+)/i.exec(from)?.[1];
  const label = domain?.split(".").slice(-2, -1)[0];
  return label ? label[0]!.toUpperCase() + label.slice(1) : null;
}

/**
 * Plain-rules stand-in for Claude, used in development and tests. It reads the
 * email with regular expressions only and never touches the network, so it is
 * rougher than the model: good enough to see the whole flow work locally.
 */
export class FakeExtractor implements Extractor {
  readonly name = "fake";

  async extract({ from, subject, text }: ExtractionInput): Promise<Extraction> {
    const type = classify(subject, text);
    const trackingNumbers =
      type === "shipping_confirmation" || type === "delivery_update"
        ? findTrackingCandidates(`${subject}\n${text}`)
            .filter((candidate) => candidate.strong)
            .slice(0, 5)
            .map((candidate) => ({
              tracking_number: candidate.trackingNumber,
              carrier: candidate.carrier.toUpperCase(),
            }))
        : [];

    const item = /^\s*(?:item|items|product)\s*[:\-]\s*(.+)$/im
      .exec(text)?.[1]
      ?.trim();
    const order =
      // An order number has at least one digit ("confirmation" is not one).
      /\border\s*(?:#|number|no\.?)?\s*[:#]?\s*((?=[A-Z0-9-]*\d)[A-Z0-9][A-Z0-9-]{3,})/i.exec(
        `${subject}\n${text}`,
      )?.[1];

    return {
      email_type: type,
      retailer: retailerFrom(from),
      item: item ? item.slice(0, 120) : null,
      order_number: order ? order.slice(0, 60) : null,
      tracking_numbers: trackingNumbers,
    };
  }
}
