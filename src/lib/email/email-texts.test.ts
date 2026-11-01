import { describe, expect, it } from "vitest";
import { emailTexts } from "./email-texts";

const LONG_HTML = "<p>Your order has shipped and is on its way.</p>";

describe("emailTexts", () => {
  it("reads the HTML when it says enough", () => {
    const texts = emailTexts({
      subject: "Shipped",
      text: "plain part",
      html: LONG_HTML,
    });
    expect(texts.fromHtml).toContain("Your order has shipped");
    expect(texts.readable).toBe(texts.fromHtml);
  });

  it("falls back to the plain text when the HTML says too little", () => {
    const texts = emailTexts({
      subject: "Shipped",
      text: "plain part",
      html: "<p>Hi</p>",
    });
    expect(texts.fromHtml).toBe("Hi");
    expect(texts.readable).toBe("plain part");
  });

  it("copes with an email that has no HTML part", () => {
    const texts = emailTexts({ subject: "S", text: "plain part", html: "" });
    expect(texts.fromHtml).toBe("");
    expect(texts.readable).toBe("plain part");
  });

  it("keeps the markup in the text numbers are checked against", () => {
    const html = `<a href="https://carrier.test/1Z999">${LONG_HTML}</a>`;
    const texts = emailTexts({ subject: "Shipped", text: "plain", html });
    expect(texts.source).toContain("Shipped");
    expect(texts.source).toContain("plain");
    expect(texts.source).toContain(html);
  });
});
