// @vitest-environment node
import { http, HttpResponse } from "msw";
import { describe, expect, it } from "vitest";
import { server } from "../../../../tests/msw/server";
import { ResendEmailSender } from "./resend";
import { SendError, type EmailMessage } from "./types";

const URL = "https://api.resend.com/emails";
const sender = new ResendEmailSender({
  apiKey: "re_test_key",
  from: "Wayfind <alerts@wayfind.example.test>",
});

const message: EmailMessage = {
  to: "sam@example.test",
  subject: "Delivered: Merino socks",
  text: "Your package has been delivered.",
  html: "<p>Your package has been delivered.</p>",
  idempotencyKey: "11111111-1111-4111-8111-111111111111",
};

const failure = (promise: Promise<unknown>) =>
  promise.then(
    () => {
      throw new Error("expected the send to fail");
    },
    (error: unknown) => error as SendError,
  );

describe("ResendEmailSender", () => {
  it("posts the message with the key, the sender address and the idempotency key", async () => {
    let seen: Request | undefined;
    let body: unknown;
    server.use(
      http.post(URL, async ({ request }) => {
        seen = request.clone();
        body = await request.json();
        return HttpResponse.json({ id: "email_123" });
      }),
    );

    await sender.send(message);

    expect(seen?.headers.get("authorization")).toBe("Bearer re_test_key");
    expect(seen?.headers.get("idempotency-key")).toBe(message.idempotencyKey);
    expect(seen?.headers.get("content-type")).toBe("application/json");
    expect(body).toEqual({
      from: "Wayfind <alerts@wayfind.example.test>",
      to: ["sam@example.test"],
      subject: message.subject,
      text: message.text,
      html: message.html,
    });
  });

  it("accepts any 2xx, even with an unexpected body", async () => {
    server.use(http.post(URL, () => new HttpResponse("ok", { status: 200 })));
    await expect(sender.send(message)).resolves.toBeUndefined();
    server.use(http.post(URL, () => new HttpResponse(null, { status: 202 })));
    await expect(sender.send(message)).resolves.toBeUndefined();
  });

  it.each([429, 409, 500, 502, 503])(
    "throws a retryable error for %i",
    async (status) => {
      server.use(http.post(URL, () => new HttpResponse("{}", { status })));
      const error = await failure(sender.send(message));
      expect(error).toBeInstanceOf(SendError);
      expect(error).toMatchObject({ retryable: true, status });
    },
  );

  it.each([400, 401, 403, 404, 422])(
    "throws a permanent error for %i",
    async (status) => {
      server.use(http.post(URL, () => new HttpResponse("{}", { status })));
      const error = await failure(sender.send(message));
      expect(error).toBeInstanceOf(SendError);
      expect(error).toMatchObject({ retryable: false, status });
    },
  );

  it("treats a network failure as retryable", async () => {
    server.use(http.post(URL, () => HttpResponse.error()));
    const error = await failure(sender.send(message));
    expect(error).toMatchObject({ retryable: true, status: null });
  });

  it("never puts the recipient, the key or the service's answer in an error", async () => {
    server.use(
      http.post(URL, () =>
        HttpResponse.json(
          { message: "invalid recipient sam@example.test" },
          { status: 422 },
        ),
      ),
    );
    const error = await failure(sender.send(message));
    expect(error.message).toBe("Email service answered 422");
    expect(error.message).not.toContain("sam@example.test");
    expect(error.message).not.toContain("re_test_key");
  });

  it("uses an injected fetch when given one", async () => {
    const calls: string[] = [];
    const custom = new ResendEmailSender({
      apiKey: "k",
      from: "a@b.test",
      fetch: async (input) => {
        calls.push(String(input));
        return new Response(null, { status: 200 });
      },
    });
    await custom.send(message);
    expect(calls).toEqual([URL]);
  });
});
