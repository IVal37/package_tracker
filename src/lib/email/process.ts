import { z } from "zod";
import type { Db } from "@/lib/db/client";
import { finishEmail } from "@/lib/db/inbound-emails";
import { loadInboundEmail } from "@/lib/db/inbound-sync";
import {
  attachShipment,
  createPlaceholder,
  createShippedOrder,
  findOrdersByKey,
} from "@/lib/db/orders";
import { findShipmentByTrackingNumber } from "@/lib/db/shipments";
import { addShipment } from "@/lib/shipments/add-shipment";
import type { TrackingProvider } from "@/lib/tracking";
import {
  ExtractionError,
  cleanDisplayText,
  groundTrackingNumbers,
  type Extraction,
  type Extractor,
} from "./extract";
import { parseGmailConfirmation } from "./gmail-confirmation";
import { htmlToText } from "./html-to-text";
import { retailerKey } from "./retailer-key";
import { findTrackingCandidates } from "./tracking-patterns";

/** How much of the email the model reads. */
export const MODEL_TEXT_CHARS = 12_000;
const MAX_NICKNAME = 60;

const storedEmailSchema = z.object({
  from: z.string().default(""),
  subject: z.string().default(""),
  text: z.string().default(""),
  html: z.string().default(""),
});

/** The work can be retried: the provider was unavailable or the model service failed. */
export class ProcessingRetryError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ProcessingRetryError";
  }
}

export type TrackingOutcome = "created" | "duplicate" | "not_found" | "invalid";

export interface ProcessResult {
  status: "missing" | "skipped" | "ignored" | "failed" | "parsed";
  /** Shipments created by this run. */
  created: number;
}

const result = (
  status: ProcessResult["status"],
  created = 0,
): ProcessResult => ({ status, created });

/**
 * Gives up on an email that kept hitting a temporary problem, so it does not
 * stay pending forever. Does nothing if it was finished in the meantime.
 */
export async function markInboundEmailFailed(
  db: Db,
  emailId: string,
  reason: string,
): Promise<void> {
  const stored = await loadInboundEmail(db, emailId);
  if (stored) {
    await finishEmail(db, stored.userId, emailId, "failed", { error: reason });
  }
}

function nicknameFrom(item: string | null, retailer: string | null) {
  const name = item ?? retailer;
  return name ? name.slice(0, MAX_NICKNAME) : null;
}

/**
 * Reads one stored email and acts on it for the user it belongs to.
 *
 * The user is whoever the email was addressed to, fixed when it was stored. The
 * model sees only this email, has no tools, and its answer is validated and
 * checked against the email's own text before anything is created. Running it
 * twice does nothing the second time.
 *
 * Throws ProcessingRetryError when trying again later may succeed (the tracking
 * provider or the model service is down); the email stays pending.
 */
export async function processInboundEmail(args: {
  db: Db;
  provider: TrackingProvider;
  extractor: Extractor;
  emailId: string;
}): Promise<ProcessResult> {
  const { db, provider, extractor, emailId } = args;

  const stored = await loadInboundEmail(db, emailId);
  if (!stored) return result("missing");
  if (stored.parseStatus !== "pending") return result("skipped");
  const userId = stored.userId;

  let email: z.infer<typeof storedEmailSchema>;
  try {
    email = storedEmailSchema.parse(JSON.parse(stored.raw));
  } catch {
    await finishEmail(db, userId, emailId, "failed", { error: "unreadable" });
    return result("failed");
  }

  // HTML keeps links (tracking numbers often live in them); fall back to the
  // plain-text part when the HTML says nothing.
  const fromHtml = email.html.trim() ? htmlToText(email.html) : "";
  const body =
    fromHtml.length >= 20 || !email.text.trim() ? fromHtml : email.text;
  const readable = body || email.text;

  const gmail = parseGmailConfirmation({
    from: email.from,
    text: email.text || readable,
  });
  if (gmail) {
    await finishEmail(db, userId, emailId, "ignored", {
      kind: "gmail_forwarding_confirmation",
      code: gmail.code,
    });
    return result("ignored");
  }

  let extraction: Extraction;
  try {
    extraction = await extractor.extract({
      from: email.from,
      subject: email.subject,
      text: readable.slice(0, MODEL_TEXT_CHARS),
    });
  } catch (error) {
    if (!(error instanceof ExtractionError)) throw error;
    if (error.retryable) throw new ProcessingRetryError(error.message);
    await finishEmail(db, userId, emailId, "failed", { error: error.message });
    return result("failed");
  }

  if (extraction.email_type === "other") {
    await finishEmail(db, userId, emailId, "ignored", {
      kind: "other",
      email_type: extraction.email_type,
    });
    return result("ignored");
  }

  const retailer = cleanDisplayText(extraction.retailer);
  const item = cleanDisplayText(extraction.item);
  const orderNumber = cleanDisplayText(extraction.order_number);
  const key = retailerKey(retailer);
  const order = {
    retailer,
    retailerKey: key,
    item,
    orderNumber,
    sourceEmailId: emailId,
  };

  // Order confirmation: remember it as "Ordered" until it ships.
  if (extraction.email_type === "order_confirmation") {
    let placeholder: "created" | "exists" | "unmatchable" = "unmatchable";
    if (key && orderNumber) {
      const existing = await findOrdersByKey(db, userId, key, orderNumber);
      placeholder =
        existing.length === 0 && (await createPlaceholder(db, userId, order))
          ? "created"
          : "exists";
    }
    await finishEmail(db, userId, emailId, "parsed", {
      email_type: extraction.email_type,
      retailer,
      item,
      order_number: orderNumber,
      placeholder,
    });
    return result("parsed");
  }

  // Shipping or delivery email: the model's grounded numbers, plus strong
  // carrier-format numbers it missed.
  const source = `${email.subject}\n${email.text}\n${email.html}\n${readable}`;
  const grounded = groundTrackingNumbers(extraction.tracking_numbers, source);
  const numbers = grounded.accepted.map((entry) => entry.trackingNumber);
  for (const candidate of findTrackingCandidates(source)) {
    if (
      candidate.strong &&
      !numbers.includes(candidate.trackingNumber) &&
      numbers.length < 5
    ) {
      numbers.push(candidate.trackingNumber);
    }
  }

  const outcomes: { tracking_number: string; outcome: TrackingOutcome }[] = [];
  let created = 0;
  let attachedPlaceholder = false;

  for (const trackingNumber of numbers) {
    const added = await addShipment({
      db,
      provider,
      userId,
      input: {
        trackingNumber,
        nickname: nicknameFrom(item, retailer) ?? undefined,
      },
    });

    let shipmentId: string | null = null;
    if (added.ok) {
      shipmentId = added.shipmentId;
      created += 1;
      outcomes.push({ tracking_number: trackingNumber, outcome: "created" });
    } else if (added.error === "duplicate") {
      shipmentId =
        (await findShipmentByTrackingNumber(db, userId, trackingNumber))?.id ??
        null;
      outcomes.push({ tracking_number: trackingNumber, outcome: "duplicate" });
    } else if (added.error === "unavailable") {
      // Quota, outage or rate limit: not the email's fault. Try again later.
      throw new ProcessingRetryError("The tracking provider is unavailable");
    } else {
      outcomes.push({
        tracking_number: trackingNumber,
        outcome: added.error === "not_found" ? "not_found" : "invalid",
      });
    }

    if (shipmentId) {
      attachedPlaceholder =
        (await linkOrder(db, userId, order, shipmentId, attachedPlaceholder)) ||
        attachedPlaceholder;
    }
  }

  await finishEmail(db, userId, emailId, "parsed", {
    email_type: extraction.email_type,
    retailer,
    item,
    order_number: orderNumber,
    tracking: outcomes,
    dropped: grounded.dropped.length,
  });
  return result("parsed", created);
}

/**
 * Connects a shipment to its order: the matching placeholder if there is one
 * (only the first shipment of an order takes it), otherwise a new order row so
 * the retailer and item are kept. Returns whether a placeholder was attached.
 */
async function linkOrder(
  db: Db,
  userId: string,
  order: {
    retailer: string | null;
    retailerKey: string | null;
    item: string | null;
    orderNumber: string | null;
    sourceEmailId: string;
  },
  shipmentId: string,
  placeholderAlreadyUsed: boolean,
): Promise<boolean> {
  if (!placeholderAlreadyUsed && order.retailerKey && order.orderNumber) {
    const [placeholder] = (
      await findOrdersByKey(db, userId, order.retailerKey, order.orderNumber)
    ).filter((row) => row.shipmentId === null);
    if (
      placeholder &&
      (await attachShipment(db, userId, placeholder.id, shipmentId))
    ) {
      return true;
    }
  }
  await createShippedOrder(db, userId, { ...order, shipmentId });
  return false;
}
