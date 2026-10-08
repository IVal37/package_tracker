// @vitest-environment node
import { describe, expect, it } from "vitest";
import {
  parseTextEmail,
  scoreExtraction,
  type EvalActual,
  type EvalExpectation,
} from "./eval-score";

const expected: EvalExpectation = {
  email_type: "shipping_confirmation",
  retailer: "Amazon",
  order_number: "112-4455667-8899001",
  tracking_numbers: [{ tracking_number: "TBA309876543210" }],
};

const actual: EvalActual = {
  email_type: "shipping_confirmation",
  retailer: "Amazon.com",
  order_number: "112-4455667-8899001",
  trackingNumbers: ["TBA309876543210"],
};

describe("scoreExtraction", () => {
  it("accepts a matching answer, comparing retailers by key", () => {
    expect(scoreExtraction(expected, actual)).toEqual([]);
  });

  it("ignores the case and spacing of tracking numbers on the expected side", () => {
    expect(
      scoreExtraction(
        {
          ...expected,
          tracking_numbers: [{ tracking_number: "tba 3098 76543210" }],
        },
        actual,
      ),
    ).toEqual([]);
  });

  it("reports a wrong email type", () => {
    expect(
      scoreExtraction(expected, { ...actual, email_type: "other" }),
    ).toEqual(["email_type: expected shipping_confirmation, got other"]);
  });

  it("reports a wrong or missing retailer", () => {
    expect(
      scoreExtraction(expected, { ...actual, retailer: "Target" }),
    ).toEqual(["retailer: expected Amazon, got Target"]);
    expect(scoreExtraction(expected, { ...actual, retailer: null })).toEqual([
      "retailer: expected Amazon, got none",
    ]);
  });

  it("reports a wrong order number", () => {
    expect(
      scoreExtraction(expected, { ...actual, order_number: "1001" }),
    ).toEqual(["order_number: expected 112-4455667-8899001, got 1001"]);
  });

  it("reports missing and unexpected tracking numbers separately", () => {
    expect(
      scoreExtraction(expected, { ...actual, trackingNumbers: ["TBA1"] }),
    ).toEqual([
      "missing tracking numbers: TBA309876543210",
      "unexpected tracking numbers: TBA1",
    ]);
  });

  it("treats an expected none and an actual none as agreeing", () => {
    expect(
      scoreExtraction(
        {
          email_type: "other",
          retailer: null,
          order_number: null,
          tracking_numbers: [],
        },
        {
          email_type: "other",
          retailer: null,
          order_number: null,
          trackingNumbers: [],
        },
      ),
    ).toEqual([]);
  });
});

describe("parseTextEmail", () => {
  it("reads From and Subject headers, then the body", () => {
    expect(
      parseTextEmail(
        "From: Target <orders@target.example.test>\nSubject: Shipped\n\nHello\nWorld\n",
      ),
    ).toEqual({
      from: "Target <orders@target.example.test>",
      subject: "Shipped",
      text: "Hello\nWorld\n",
      html: "",
    });
  });

  it("accepts Windows line endings and any header case", () => {
    const email = parseTextEmail("FROM: a@b.test\r\nsubject: Hi\r\n\r\nBody");
    expect(email).toMatchObject({ from: "a@b.test", subject: "Hi" });
    expect(email.text).toBe("Body");
  });

  it("treats an HTML body as HTML", () => {
    const email = parseTextEmail(
      "From: a@b.test\nSubject: Hi\n\n<html><body><p>Hello</p></body></html>",
    );
    expect(email.html).toContain("<p>Hello</p>");
    expect(email.text).toBe("");
  });

  it("treats a file without a header block as all body", () => {
    const email = parseTextEmail("Just the message.\nSecond line.");
    expect(email).toEqual({
      from: "",
      subject: "",
      text: "Just the message.\nSecond line.",
      html: "",
    });
  });
});
