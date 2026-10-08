// @vitest-environment node
import { describe, expect, it, vi } from "vitest";
import { MAX_PART_CHARS as APP_MAX_PART_CHARS } from "@/lib/email/receive";
import {
  MAX_PART_CHARS,
  MAX_RAW_BYTES,
  handleInboundMessage,
  type HandlerConfig,
  type InboundMessage,
  type ParsedMail,
} from "./handler";

const ENDPOINT = "https://app.test/api/webhooks/inbound-email";

const message = (overrides: Partial<InboundMessage> = {}): InboundMessage => ({
  from: "bounce@mailer.example.test",
  to: "izaak-7f3k@in.wayfind.test",
  raw: new ReadableStream<Uint8Array>(),
  rawSize: 1_000,
  ...overrides,
});

const setup = (
  parsed: ParsedMail = {},
  respond: () => Response = () => new Response(null, { status: 200 }),
) => {
  const fetchMock = vi.fn<typeof fetch>(async () => respond());
  const parse = vi.fn(async () => parsed);
  const config: HandlerConfig = {
    endpoint: ENDPOINT,
    secret: "s3cret",
    fetch: fetchMock,
    parse,
  };
  const sentBody = () =>
    JSON.parse(String(fetchMock.mock.calls[0]![1]!.body)) as Record<
      string,
      unknown
    >;
  return { config, fetchMock, parse, sentBody };
};

describe("handleInboundMessage", () => {
  it("posts the parsed email as JSON with the bearer secret", async () => {
    const { config, fetchMock, sentBody } = setup({
      from: { name: "Target", address: "orders@target.example.test" },
      subject: "Your order shipped",
      messageId: "<abc@mail.test>",
      date: "2026-06-10T12:00:00.000Z",
      text: "Tracking 1Z999AA10123456784",
      html: "<p>Tracking 1Z999AA10123456784</p>",
    });

    const outcome = await handleInboundMessage(message(), config);

    expect(outcome).toBe("forwarded");
    expect(fetchMock).toHaveBeenCalledOnce();
    const [url, init] = fetchMock.mock.calls[0]!;
    expect(url).toBe(ENDPOINT);
    expect(init!.method).toBe("POST");
    expect(init!.headers).toEqual({
      "content-type": "application/json",
      authorization: "Bearer s3cret",
    });
    expect(sentBody()).toEqual({
      recipient: "izaak-7f3k@in.wayfind.test",
      from: "Target <orders@target.example.test>",
      subject: "Your order shipped",
      messageId: "<abc@mail.test>",
      date: "2026-06-10T12:00:00.000Z",
      text: "Tracking 1Z999AA10123456784",
      html: "<p>Tracking 1Z999AA10123456784</p>",
    });
  });

  it("forwards the envelope recipient, not the To: header", async () => {
    // Gmail auto-forwarding keeps the user's own address in To:. The parser
    // result is not even offered a recipient field to copy from.
    const { config, sentBody } = setup({ subject: "x" });
    await handleInboundMessage(
      message({ to: "izaak-7f3k@in.wayfind.test" }),
      config,
    );
    expect(sentBody().recipient).toBe("izaak-7f3k@in.wayfind.test");
  });

  it("uses the envelope sender when the message has no From header", async () => {
    const { config, sentBody } = setup({});
    await handleInboundMessage(message(), config);
    expect(sentBody().from).toBe("bounce@mailer.example.test");
  });

  it("sends a bare address when the From header has no name", async () => {
    const { config, sentBody } = setup({
      from: { address: "forwarding-noreply@google.com" },
    });
    await handleInboundMessage(message(), config);
    expect(sentBody().from).toBe("forwarding-noreply@google.com");
  });

  it("sends empty strings and nulls for missing parts", async () => {
    const { config, sentBody } = setup({});
    await handleInboundMessage(message(), config);
    expect(sentBody()).toMatchObject({
      subject: "",
      messageId: null,
      date: null,
      text: "",
      html: "",
    });
  });

  it("caps text and HTML at the limit the app enforces", async () => {
    expect(MAX_PART_CHARS).toBe(APP_MAX_PART_CHARS);
    const { config, sentBody } = setup({
      text: "t".repeat(MAX_PART_CHARS + 500),
      html: "h".repeat(MAX_PART_CHARS + 500),
    });
    await handleInboundMessage(message(), config);
    expect(String(sentBody().text)).toHaveLength(MAX_PART_CHARS);
    expect(String(sentBody().html)).toHaveLength(MAX_PART_CHARS);
  });

  it("drops the HTML when escaping would push the body past what the app accepts", async () => {
    // Control characters escape to six characters each: this HTML alone
    // becomes ~1.2 million characters on the wire.
    const { config, fetchMock, sentBody } = setup({
      text: "x".repeat(MAX_PART_CHARS),
      html: "".repeat(MAX_PART_CHARS),
    });
    await handleInboundMessage(message(), config);
    expect(String(fetchMock.mock.calls[0]![1]!.body).length).toBeLessThan(
      1_000_000,
    );
    expect(sentBody().html).toBe("");
    expect(String(sentBody().text)).toHaveLength(MAX_PART_CHARS);
  });

  it("trims the text too when even that is not enough", async () => {
    // Control characters escape to six characters each.
    const { config, fetchMock, sentBody } = setup({
      text: "".repeat(MAX_PART_CHARS),
      html: "x",
    });
    await handleInboundMessage(message(), config);
    expect(String(fetchMock.mock.calls[0]![1]!.body).length).toBeLessThan(
      1_000_000,
    );
    expect(sentBody().html).toBe("");
    const text = String(sentBody().text);
    expect(text.length).toBeGreaterThan(100_000);
    expect(text.length).toBeLessThan(MAX_PART_CHARS);
  });

  it("skips a message over 25 MiB without parsing or sending it", async () => {
    const { config, fetchMock, parse } = setup({ text: "x" });
    const outcome = await handleInboundMessage(
      message({ rawSize: MAX_RAW_BYTES + 1 }),
      config,
    );
    expect(outcome).toBe("skipped_too_large");
    expect(parse).not.toHaveBeenCalled();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("accepts a message of exactly 25 MiB", async () => {
    const { config, fetchMock } = setup({ text: "x" });
    await handleInboundMessage(message({ rawSize: MAX_RAW_BYTES }), config);
    expect(fetchMock).toHaveBeenCalledOnce();
  });

  it.each([401, 413, 422])(
    "drops quietly when the app answers %i",
    async (status) => {
      const { config } = setup(
        { text: "x" },
        () => new Response(null, { status }),
      );
      await expect(handleInboundMessage(message(), config)).resolves.toBe(
        "dropped",
      );
    },
  );

  it.each([500, 502, 503])(
    "throws when the app answers %i, so the sender retries",
    async (status) => {
      const { config } = setup(
        { text: "x" },
        () => new Response(null, { status }),
      );
      await expect(handleInboundMessage(message(), config)).rejects.toThrow(
        `status ${status}`,
      );
    },
  );

  it("throws when the app cannot be reached", async () => {
    const { config, fetchMock } = setup({ text: "x" });
    fetchMock.mockRejectedValue(new TypeError("network down"));
    await expect(handleInboundMessage(message(), config)).rejects.toThrow(
      "network down",
    );
  });

  it("does not put the email or the secret in an error message", async () => {
    const { config } = setup(
      { subject: "Private subject", text: "Private body" },
      () => new Response(null, { status: 503 }),
    );
    const error = await handleInboundMessage(message(), config).catch(
      (e: Error) => e,
    );
    expect(String((error as Error).message)).not.toMatch(
      /Private|s3cret|izaak/,
    );
  });
});
