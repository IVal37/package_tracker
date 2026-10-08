import { describe, expect, it } from "vitest";
import { parseGmailConfirmation } from "./gmail-confirmation";

const BODY = [
  "izaak@gmail.com has requested to automatically forward mail to your email address izaak-7f3k@in.wayfind.app.",
  "",
  "Confirmation code: 99427480",
  "",
  "To allow izaak@gmail.com to automatically forward mail to your address, please click the link below to confirm the request:",
  "https://mail-settings.google.com/mail/vf-xyz",
].join("\n");

describe("parseGmailConfirmation", () => {
  it.each([
    ["a bare address", "forwarding-noreply@google.com"],
    ["a display name", "Gmail Team <forwarding-noreply@google.com>"],
    ["upper case", "FORWARDING-NOREPLY@GOOGLE.COM"],
    ["extra spaces", "  Gmail Team <forwarding-noreply@google.com>  "],
  ])("reads the code from Gmail's message sent as %s", (_name, from) => {
    expect(parseGmailConfirmation({ from, text: BODY })).toEqual({
      code: "99427480",
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

  it.each([
    ["no code in the body", "Hello, nothing here."],
    ["a code that is too short", "Confirmation code: 12345"],
    ["a code that is too long", "Confirmation code: 12345678901"],
    ["letters in the code", "Confirmation code: 1234ABCD"],
    ["an empty body", ""],
  ])("returns null for %s", (_name, text) => {
    expect(
      parseGmailConfirmation({ from: "forwarding-noreply@google.com", text }),
    ).toBeNull();
  });

  it("accepts codes of 6 to 10 digits, in any case", () => {
    for (const code of ["123456", "12345678", "1234567890"]) {
      expect(
        parseGmailConfirmation({
          from: "forwarding-noreply@google.com",
          text: `CONFIRMATION CODE:   ${code}`,
        }),
      ).toEqual({ code });
    }
  });

  it("returns only the digits, never the link", () => {
    const result = parseGmailConfirmation({
      from: "forwarding-noreply@google.com",
      text: BODY,
    });
    expect(JSON.stringify(result)).not.toContain("http");
  });
});
