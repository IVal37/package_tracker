// What an alert says, as a push notification and as an email. Pure.
//
// Names, items and places can come from a forwarded email, so they are
// untrusted text: the email's HTML escapes every value, the push is plain text
// by nature, and links are built only from our own origin and a UUID.
import type { Status } from "@/lib/tracking/status";
import type { NotificationKind } from "./rules";
import type { PushPayload } from "./senders/types";

export interface AlertSubject {
  /** What to call the package: its nickname, which may have come from an order email. */
  nickname: string | null;
  trackingNumber: string;
  status: Status;
  eta: Date | null;
  /** The newest checkpoint, if any. */
  lastCheckpoint: {
    message: string | null;
    locationText: string | null;
  } | null;
}

export interface BuiltMessage {
  push: PushPayload;
  email: { subject: string; text: string; html: string };
}

const MAX_TITLE = 100;
const MAX_BODY = 200;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Escapes text for use inside HTML element content or a quoted attribute. */
export function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

/** Collapses whitespace, strips control characters and cuts to a length. */
function tidy(value: string, max: number): string {
  const flat = value
    .replace(/[\u0000-\u001f\u007f]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  return flat.length > max ? `${flat.slice(0, max - 1).trimEnd()}…` : flat;
}

/** The first line of the alert. The tracking number is deliberately not here. */
function headline(kind: NotificationKind, status: Status): string {
  switch (kind) {
    case "out_for_delivery":
      return "Out for delivery";
    case "delivered":
      return status === "AvailableForPickup" ? "Ready for pickup" : "Delivered";
    case "problem":
      return status === "AttemptFail"
        ? "Delivery attempted"
        : "Delivery problem";
    case "delay":
      return "Running late";
  }
}

/** A sentence for the push body when the courier's own words are not available. */
function fallbackBody(kind: NotificationKind, status: Status): string {
  switch (kind) {
    case "out_for_delivery":
      return "Your package is on the final leg and should arrive today.";
    case "delivered":
      return status === "AvailableForPickup"
        ? "Your package is waiting for you at a pickup point."
        : "Your package has been delivered.";
    case "problem":
      return status === "AttemptFail"
        ? "The courier could not deliver your package."
        : "The courier reported a problem with your package.";
    case "delay":
      return "Your package is taking longer than expected.";
  }
}

function etaSentence(eta: Date | null): string | null {
  if (!eta) return null;
  const day = new Intl.DateTimeFormat("en-US", {
    timeZone: "UTC",
    weekday: "long",
    month: "short",
    day: "numeric",
  }).format(eta);
  return `Estimated delivery: ${day}.`;
}

/** The link to open a package in the app. Throws on an id that is not a UUID. */
export function shipmentUrl(appUrl: string, shipmentId: string): string {
  if (!UUID.test(shipmentId)) throw new Error("Not a shipment id");
  return `${appUrl.replace(/\/+$/, "")}/?shipment=${shipmentId}`;
}

export function buildMessage(args: {
  kind: NotificationKind;
  subject: AlertSubject;
  shipmentId: string;
  appUrl: string;
}): BuiltMessage {
  const { kind, subject, shipmentId } = args;
  const appUrl = args.appUrl.replace(/\/+$/, "");
  const url = shipmentUrl(appUrl, shipmentId);
  const settingsUrl = `${appUrl}/settings`;

  const name = tidy(subject.nickname ?? "", 60) || "Your package";
  const title = tidy(`${headline(kind, subject.status)}: ${name}`, MAX_TITLE);

  const checkpoint = [
    subject.lastCheckpoint?.message,
    subject.lastCheckpoint?.locationText,
  ]
    .filter((part): part is string => Boolean(part))
    .map((part) => tidy(part, MAX_BODY))
    .filter(Boolean)
    .join(" · ");
  const eta = kind === "delay" ? etaSentence(subject.eta) : null;
  const detail = checkpoint || fallbackBody(kind, subject.status);
  const body = tidy([detail, eta].filter(Boolean).join(" "), MAX_BODY);

  // The email has room for more, including the tracking number.
  const lines = [
    detail,
    ...(eta ? [eta] : []),
    "",
    `Tracking number: ${tidy(subject.trackingNumber, 60)}`,
    `View it: ${url}`,
    "",
    `You get this because of your alert settings. Change them: ${settingsUrl}`,
  ];
  const text = lines.join("\n");

  const html = [
    "<!doctype html>",
    '<html><body style="font-family: system-ui, sans-serif; line-height: 1.5;">',
    `<h2 style="margin: 0 0 8px;">${escapeHtml(title)}</h2>`,
    `<p>${escapeHtml(detail)}</p>`,
    ...(eta ? [`<p>${escapeHtml(eta)}</p>`] : []),
    `<p style="color: #555;">Tracking number: ${escapeHtml(tidy(subject.trackingNumber, 60))}</p>`,
    `<p><a href="${escapeHtml(url)}">View this package in Wayfind</a></p>`,
    `<p style="color: #777; font-size: 12px;">You get this because of your alert settings. <a href="${escapeHtml(settingsUrl)}">Change them</a>.</p>`,
    "</body></html>",
  ].join("\n");

  return {
    push: { title, body, url, tag: `shipment-${shipmentId}` },
    email: { subject: title, text, html },
  };
}
