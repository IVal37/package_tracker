// Gmail will not forward to a new address until the owner confirms it, with a
// link or a code Gmail emails to that address. The only mail that address ever
// sees is what we receive, so we catch it and show it on the Setup page.
//
// The email is untrusted, so what is kept is narrow. The code is only digits.
// The link is kept only if it is an https link to one of Google's own
// confirmation pages (a fixed list of hosts, the `/mail/vf-` path, no
// credentials). Anything else in the email is dropped, so a forged email can at
// worst show a Google confirmation page that Gmail itself will reject.

const GMAIL_SENDER = "forwarding-noreply@google.com";

/** The hosts Gmail's confirmation links have been seen on. */
const LINK_HOSTS = new Set([
  "mail-settings.google.com",
  "mail.google.com",
  "isolated.mail.google.com",
]);
/** `/mail/uf-` is the "cancel" link beside it: never offered. */
const LINK_PATH_PREFIX = "/mail/vf-";
const MAX_LINK_CHARS = 1000;

export interface GmailConfirmationInput {
  from: string;
  text: string;
}

export interface GmailConfirmation {
  code: string | null;
  link: string | null;
}

/** What is kept on the stored email; `latestGmailConfirmation` reads it back. */
export function gmailConfirmationRecord({ code, link }: GmailConfirmation) {
  return { kind: "gmail_forwarding_confirmation", code, link } as const;
}

/** The link itself if it is a Gmail confirmation link, else null. */
export function safeGmailConfirmationLink(candidate: string): string | null {
  if (candidate.length > MAX_LINK_CHARS || /\s/.test(candidate)) return null;
  let url: URL;
  try {
    url = new URL(candidate);
  } catch {
    return null;
  }
  const ok =
    url.protocol === "https:" &&
    LINK_HOSTS.has(url.hostname) &&
    url.port === "" &&
    url.username === "" &&
    url.password === "" &&
    url.pathname.startsWith(LINK_PATH_PREFIX);
  return ok ? candidate : null;
}

function findConfirmationLink(text: string): string | null {
  for (const match of text.matchAll(/https:\/\/[^\s<>"'`]+/gi)) {
    // A link at the end of a sentence or in brackets drags the punctuation in.
    const link = safeGmailConfirmationLink(
      match[0].replace(/[.,;:!?)\]>]+$/, ""),
    );
    if (link) return link;
  }
  return null;
}

/**
 * The code and/or confirmation link if this is Gmail's forwarding
 * confirmation, else null. Either may be missing: Gmail has sent a link, a
 * code, or both.
 */
export function parseGmailConfirmation({
  from,
  text,
}: GmailConfirmationInput): GmailConfirmation | null {
  const address = /<([^<>]+)>\s*$/.exec(from.trim())?.[1] ?? from;
  if (address.trim().toLowerCase() !== GMAIL_SENDER) return null;

  const code = /confirmation code:\s*(\d{6,10})\b/i.exec(text)?.[1] ?? null;
  const link = findConfirmationLink(text);
  return code || link ? { code, link } : null;
}
