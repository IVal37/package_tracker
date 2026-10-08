// Gmail will not forward to a new address until the owner confirms it with a
// code Gmail emails to that address. The only mail that address ever sees is
// what we receive, so we catch the code and show it in Settings.
//
// Only the digits are kept, never the confirmation link: the email is untrusted,
// and a code someone spoofed is harmless (Gmail simply rejects it).

const GMAIL_SENDER = "forwarding-noreply@google.com";

export interface GmailConfirmationInput {
  from: string;
  text: string;
}

/** The confirmation code if this is Gmail's forwarding confirmation, else null. */
export function parseGmailConfirmation({
  from,
  text,
}: GmailConfirmationInput): { code: string } | null {
  const address = /<([^<>]+)>\s*$/.exec(from.trim())?.[1] ?? from;
  if (address.trim().toLowerCase() !== GMAIL_SENDER) return null;

  const code = /confirmation code:\s*(\d{6,10})\b/i.exec(text)?.[1];
  return code ? { code } : null;
}
