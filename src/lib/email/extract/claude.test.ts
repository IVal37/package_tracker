// @vitest-environment node
import { http, HttpResponse } from "msw";
import { describe, expect, it } from "vitest";
import errors from "../../../../tests/fixtures/anthropic/errors.json";
import maxTokens from "../../../../tests/fixtures/anthropic/max-tokens.json";
import message from "../../../../tests/fixtures/anthropic/message.json";
import refusal from "../../../../tests/fixtures/anthropic/refusal.json";
import { server } from "../../../../tests/msw/server";
import { ClaudeExtractor, EXTRACTION_MODEL } from "./claude";
import { ExtractionError } from "./types";

const URL = "https://api.anthropic.com/v1/messages";
const extractor = new ClaudeExtractor({
  apiKey: "sk-ant-test-key",
  maxRetries: 0,
});

const INPUT = {
  from: "Amazon.com <shipment-tracking@amazon.com>",
  subject: "Your package has shipped",
  text: "Order #112-4455667-8899001\nTracking: TBA123456789012\nItem: Merino socks",
};

const ANSWER = {
  email_type: "shipping_confirmation",
  retailer: "Amazon",
  item: "Merino socks",
  order_number: "112-4455667-8899001",
  tracking_numbers: [
    { tracking_number: "TBA123456789012", carrier: "Amazon Logistics" },
  ],
};

/** The saved envelope with the model's text replaced. */
const reply = (answer: unknown) =>
  HttpResponse.json({
    ...message,
    content: [
      {
        type: "text",
        text: typeof answer === "string" ? answer : JSON.stringify(answer),
      },
    ],
  });

const answerWith = (body: unknown) =>
  server.use(http.post(URL, () => reply(body)));

const failure = async (promise: Promise<unknown>) => {
  try {
    await promise;
  } catch (error) {
    return error;
  }
  throw new Error("expected a rejection");
};

/** The parts of the request body these tests look at. */
interface CapturedBody {
  model: string;
  temperature: number;
  max_tokens: number;
  system: string;
  messages: { role: string; content: string }[];
  output_config: {
    format: {
      type: string;
      schema: {
        additionalProperties: boolean;
        required: string[];
        properties: Record<string, unknown>;
      };
    };
  };
}

describe("ClaudeExtractor: the request", () => {
  async function capture() {
    let headers: Headers | undefined;
    let body: CapturedBody = {} as CapturedBody;
    server.use(
      http.post(URL, async ({ request }) => {
        headers = request.headers;
        body = (await request.json()) as CapturedBody;
        return reply(ANSWER);
      }),
    );
    await extractor.extract(INPUT);
    return { headers: headers!, body };
  }

  it("asks Haiku 4.5, with no tools, no thinking and temperature 0", async () => {
    const { body } = await capture();
    expect(EXTRACTION_MODEL).toBe("claude-haiku-4-5");
    expect(body.model).toBe("claude-haiku-4-5");
    expect(body.temperature).toBe(0);
    expect(body).not.toHaveProperty("tools");
    expect(body).not.toHaveProperty("tool_choice");
    expect(body).not.toHaveProperty("thinking");
    expect(body.max_tokens).toBe(1024);
  });

  it("sends the key and nothing else secret", async () => {
    const { headers, body } = await capture();
    expect(headers.get("x-api-key")).toBe("sk-ant-test-key");
    expect(JSON.stringify(body)).not.toContain("sk-ant-test-key");
  });

  it("puts the email in <email> tags in the user message and the rules in the system prompt", async () => {
    const { body } = await capture();
    expect(body.system).toContain("untrusted");
    expect(body.system).toContain("no tools");
    expect(body.messages).toHaveLength(1);
    const [message] = body.messages;
    expect(message?.role).toBe("user");
    const content = message?.content ?? "";
    expect(content.startsWith("<email>")).toBe(true);
    expect(content.trimEnd().endsWith("</email>")).toBe(true);
    expect(content).toContain(
      "From: Amazon.com <shipment-tracking@amazon.com>",
    );
    expect(content).toContain("TBA123456789012");
    // The email's text is never part of the instructions.
    expect(body.system).not.toContain("TBA123456789012");
  });

  it("constrains the answer to a JSON schema with exactly the allowed fields", async () => {
    const { body } = await capture();
    const format = body.output_config.format;
    expect(format.type).toBe("json_schema");
    expect(format.schema.additionalProperties).toBe(false);
    expect(Object.keys(format.schema.properties).sort()).toEqual([
      "email_type",
      "item",
      "order_number",
      "retailer",
      "tracking_numbers",
    ]);
    expect(format.schema.required.sort()).toEqual(
      Object.keys(format.schema.properties).sort(),
    );
  });
});

describe("ClaudeExtractor: valid answers", () => {
  it("returns the validated extraction", async () => {
    answerWith(ANSWER);
    expect(await extractor.extract(INPUT)).toEqual(ANSWER);
  });

  it("accepts nulls and an empty tracking list", async () => {
    const quiet = {
      email_type: "other",
      retailer: null,
      item: null,
      order_number: null,
      tracking_numbers: [],
    };
    answerWith(quiet);
    expect(await extractor.extract(INPUT)).toEqual(quiet);
  });

  it("treats empty strings as null", async () => {
    answerWith({ ...ANSWER, retailer: "", item: "  ", tracking_numbers: [] });
    const result = await extractor.extract(INPUT);
    expect(result.retailer).toBeNull();
    expect(result.item).toBeNull();
  });
});

describe("ClaudeExtractor: malformed output is rejected", () => {
  const cases: [string, unknown][] = [
    ["prose instead of JSON", "Sure! Here is the data you asked for."],
    ["JSON wrapped in prose", `Here you go: ${JSON.stringify(ANSWER)}`],
    ["a JSON array", "[1, 2, 3]"],
    ["a JSON string", '"shipping_confirmation"'],
    ["null", "null"],
    ["an empty object", {}],
    ["a missing field", { ...ANSWER, retailer: undefined }],
    ["an unknown email_type", { ...ANSWER, email_type: "phishing" }],
    [
      "an extra field (user_email)",
      { ...ANSWER, user_email: "victim@example.test" },
    ],
    ["an extra field (owner)", { ...ANSWER, owner: "another-user-id" }],
    [
      "an extra field inside a tracking entry",
      {
        ...ANSWER,
        tracking_numbers: [
          {
            tracking_number: "TBA123456789012",
            carrier: null,
            url: "https://evil.test",
          },
        ],
      },
    ],
    ["a number where text is expected", { ...ANSWER, item: 42 }],
    [
      "an object where text is expected",
      { ...ANSWER, retailer: { name: "Amazon" } },
    ],
    ["an over-long retailer", { ...ANSWER, retailer: "R".repeat(81) }],
    ["an over-long item", { ...ANSWER, item: "I".repeat(121) }],
    ["an over-long order number", { ...ANSWER, order_number: "9".repeat(61) }],
    [
      "an over-long tracking number",
      {
        ...ANSWER,
        tracking_numbers: [{ tracking_number: "T".repeat(61), carrier: null }],
      },
    ],
    [
      "too many tracking numbers",
      {
        ...ANSWER,
        tracking_numbers: Array.from({ length: 6 }, (_, i) => ({
          tracking_number: `TBA00000000000${i}`,
          carrier: null,
        })),
      },
    ],
    [
      "tracking_numbers as a string",
      { ...ANSWER, tracking_numbers: "TBA123456789012" },
    ],
    [
      "tracking entries as bare strings",
      { ...ANSWER, tracking_numbers: ["TBA123456789012"] },
    ],
  ];

  it.each(cases)(
    "rejects %s without creating anything",
    async (_name, answer) => {
      answerWith(answer);
      const error = await failure(extractor.extract(INPUT));
      expect(error).toBeInstanceOf(ExtractionError);
      expect((error as ExtractionError).retryable).toBe(false);
    },
  );

  it("never puts the model's output or the email in the error", async () => {
    answerWith({
      ...ANSWER,
      user_email: "victim-secret@example.test",
      item: 5,
    });
    const error = (await failure(extractor.extract(INPUT))) as ExtractionError;
    expect(error.message).not.toContain("victim-secret");
    expect(error.message).not.toContain("TBA123456789012");
    expect(error.message).toContain("failed validation");
  });

  it("rejects a response with no text block", async () => {
    server.use(
      http.post(URL, () => HttpResponse.json({ ...message, content: [] })),
    );
    const error = (await failure(extractor.extract(INPUT))) as ExtractionError;
    expect(error).toBeInstanceOf(ExtractionError);
    expect(error.retryable).toBe(false);
  });

  it("rejects a refusal", async () => {
    server.use(http.post(URL, () => HttpResponse.json(refusal)));
    const error = (await failure(extractor.extract(INPUT))) as ExtractionError;
    expect(error).toBeInstanceOf(ExtractionError);
    expect(error.retryable).toBe(false);
    expect(error.message).toContain("declined");
  });

  it("rejects an answer that was cut off, even if it is a valid prefix", async () => {
    server.use(http.post(URL, () => HttpResponse.json(maxTokens)));
    const error = (await failure(extractor.extract(INPUT))) as ExtractionError;
    expect(error).toBeInstanceOf(ExtractionError);
    expect(error.retryable).toBe(false);
    expect(error.message).toContain("cut off");
  });
});

describe("ClaudeExtractor: service errors", () => {
  const status = (code: keyof typeof errors) =>
    server.use(
      http.post(URL, () =>
        HttpResponse.json(errors[code], { status: Number(code) }),
      ),
    );

  it.each([
    ["429", true],
    ["500", true],
    ["529", true],
    ["401", false],
    ["400", false],
  ] as const)("HTTP %s is retryable=%s", async (code, retryable) => {
    status(code);
    const error = (await failure(extractor.extract(INPUT))) as ExtractionError;
    expect(error).toBeInstanceOf(ExtractionError);
    expect(error.retryable).toBe(retryable);
  });

  it("treats a network failure as retryable", async () => {
    server.use(http.post(URL, () => HttpResponse.error()));
    const error = (await failure(extractor.extract(INPUT))) as ExtractionError;
    expect(error).toBeInstanceOf(ExtractionError);
    expect(error.retryable).toBe(true);
  });

  it("does not leak the key, the email or Anthropic's message in errors", async () => {
    status("401");
    const error = (await failure(extractor.extract(INPUT))) as ExtractionError;
    for (const secret of [
      "sk-ant-test-key",
      "TBA123456789012",
      "invalid x-api-key",
    ]) {
      expect(error.message).not.toContain(secret);
      expect(String(error.stack)).not.toContain("sk-ant-test-key");
    }
  });
});
