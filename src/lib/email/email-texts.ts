import { htmlToText } from "./html-to-text";

export interface EmailTexts {
  /** The HTML part as plain text (link targets kept); empty when there is none. */
  fromHtml: string;
  /** What the model reads, before it is cut to length. */
  readable: string;
  /** Where a tracking number from the model must appear, markup included. */
  source: string;
}

/** The forms of one email's text that reading it needs. */
export function emailTexts(email: {
  subject: string;
  text: string;
  html: string;
}): EmailTexts {
  // HTML keeps links (tracking numbers often live in them); fall back to the
  // plain-text part when the HTML says nothing.
  const fromHtml = email.html.trim() ? htmlToText(email.html) : "";
  const body =
    fromHtml.length >= 20 || !email.text.trim() ? fromHtml : email.text;
  const readable = body || email.text;
  return {
    fromHtml,
    readable,
    source: `${email.subject}\n${email.text}\n${email.html}\n${readable}`,
  };
}
