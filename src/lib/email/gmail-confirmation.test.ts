import { describe, expect, it } from "vitest";
import {
  gmailConfirmationRecord,
  parseGmailConfirmation,
  safeGmailConfirmationLink,
} from "./gmail-confirmation";

const LINK = "https://mail-settings.google.com/mail/vf-%5BANGjdJ%5D-xyz";
const CANCEL = "https://mail-settings.google.com/mail/uf-%5BANGjdJ%5D-xyz";
const SENDER = "forwarding-noreply@google.com";

const BODY = [
  "izaak@gmail.com has requested to automatically forward mail to your email address izaak-7f3k@in.wayfind.app.",
  "",
  "Confirmation code: 99427480",
  "",
  "To allow izaak@gmail.com to automatically forward mail to your address, please click the link below to confirm the request:",
  LINK,
  "",
  "If you click the link and it appears to be broken, copy and paste the code above.",
  "To cancel this request, click:",
  CANCEL,
].join("\n");

describe("parseGmailConfirmation: the sender", () => {
  it.each([
    ["a bare address", "forwarding-noreply@google.com"],
    ["a display name", "Gmail Team <forwarding-noreply@google.com>"],
    ["upper case", "FORWARDING-NOREPLY@GOOGLE.COM"],
    ["extra spaces", "  Gmail Team <forwarding-noreply@google.com>  "],
  ])("reads Gmail's message sent as %s", (_name, from) => {
    expect(parseGmailConfirmation({ from, text: BODY })).toEqual({
      code: "99427480",
      link: LINK,
    });
  });

  it.each([
    ["another sender", "friend@example.com"],
    ["a look-alike domain", "forwarding-noreply@google.com.evil.test"],
    ["a look-alike local part", "forwarding-noreply2@google.com"],
    [
      "a similar name with a different address",
      "forwarding-noreply@google.com <attacker@evil.test>",
    ],
    ["an empty sender", ""],
  ])("ignores the same text from %s", (_name, from) => {
    expect(parseGmailConfirmation({ from, text: BODY })).toBeNull();
  });
});

describe("parseGmailConfirmation: the code", () => {
  it("reads a code with no link", () => {
    expect(
      parseGmailConfirmation({
        from: SENDER,
        text: "Confirmation code: 12345678",
      }),
    ).toEqual({ code: "12345678", link: null });
  });

  it.each([
    ["no code in the body", "Hello, nothing here."],
    ["a code that is too short", "Confirmation code: 12345"],
    ["a code that is too long", "Confirmation code: 12345678901"],
    ["letters in the code", "Confirmation code: 1234ABCD"],
    ["an empty body", ""],
  ])("returns null for %s", (_name, text) => {
    expect(parseGmailConfirmation({ from: SENDER, text })).toBeNull();
  });

  it("accepts codes of 6 to 10 digits, in any case", () => {
    for (const code of ["123456", "12345678", "1234567890"]) {
      expect(
        parseGmailConfirmation({
          from: SENDER,
          text: `CONFIRMATION CODE:   ${code}`,
        }),
      ).toEqual({ code, link: null });
    }
  });
});

describe("parseGmailConfirmation: the link", () => {
  it("reads a link with no code", () => {
    expect(
      parseGmailConfirmation({
        from: SENDER,
        text: `Please confirm:\n${LINK}\n`,
      }),
    ).toEqual({ code: null, link: LINK });
  });

  it("offers the confirm link, never the cancel link beside it", () => {
    const result = parseGmailConfirmation({
      from: SENDER,
      text: `Cancel: ${CANCEL}\nConfirm: ${LINK}`,
    });
    expect(result?.link).toBe(LINK);
  });

  it("returns null when the only link is the cancel link", () => {
    expect(
      parseGmailConfirmation({ from: SENDER, text: `Cancel: ${CANCEL}` }),
    ).toBeNull();
  });

  it.each([
    ["a full stop", `Click ${LINK}.`],
    ["a comma", `Click ${LINK}, then wait.`],
    ["brackets", `Click (${LINK})`],
    ["angle brackets", `Click <${LINK}>`],
    ["quotes", `Click "${LINK}"`],
  ])("finds the link when it is followed by %s", (_name, text) => {
    expect(parseGmailConfirmation({ from: SENDER, text })?.link).toBe(LINK);
  });

  it("skips a link to somewhere else and takes the Google one", () => {
    expect(
      parseGmailConfirmation({
        from: SENDER,
        text: `https://evil.test/mail/vf-x ${LINK}`,
      })?.link,
    ).toBe(LINK);
  });

  it("returns only the code, not a link to somewhere else", () => {
    const result = parseGmailConfirmation({
      from: SENDER,
      text: "Confirmation code: 12345678\nhttps://evil.test/mail/vf-x",
    });
    expect(result).toEqual({ code: "12345678", link: null });
  });
});

describe("safeGmailConfirmationLink", () => {
  it.each([
    "https://mail-settings.google.com/mail/vf-abc",
    "https://mail.google.com/mail/vf-abc",
    "https://isolated.mail.google.com/mail/vf-abc?x=1&y=2",
  ])("accepts %s", (link) => {
    expect(safeGmailConfirmationLink(link)).toBe(link);
  });

  it.each([
    ["plain http", "http://mail-settings.google.com/mail/vf-abc"],
    ["another host", "https://evil.test/mail/vf-abc"],
    [
      "a look-alike host",
      "https://mail-settings.google.com.evil.test/mail/vf-a",
    ],
    ["a sub-domain of it", "https://x.mail-settings.google.com/mail/vf-abc"],
    [
      "credentials in front of the host",
      "https://google.com@evil.test/mail/vf-a",
    ],
    ["a username on the real host", "https://u:p@mail.google.com/mail/vf-abc"],
    ["a port", "https://mail.google.com:8443/mail/vf-abc"],
    ["the cancel path", "https://mail.google.com/mail/uf-abc"],
    ["another Google page", "https://mail.google.com/mail/u/0/"],
    ["a script link", "javascript:alert(1)"],
    ["a data link", "data:text/html,hi"],
    ["not a link", "mail-settings.google.com/mail/vf-abc"],
    ["white space inside", "https://mail.google.com/mail/vf-a bc"],
    [
      "something very long",
      `https://mail.google.com/mail/vf-${"a".repeat(1000)}`,
    ],
    ["an empty string", ""],
  ])("refuses %s", (_name, link) => {
    expect(safeGmailConfirmationLink(link)).toBeNull();
  });
});

describe("gmailConfirmationRecord", () => {
  it("keeps only the kind, the code and the link", () => {
    expect(gmailConfirmationRecord({ code: "12345678", link: LINK })).toEqual({
      kind: "gmail_forwarding_confirmation",
      code: "12345678",
      link: LINK,
    });
  });
});
