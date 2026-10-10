import type { ErrorEvent } from "@sentry/nextjs";
import { describe, expect, it } from "vitest";
import { redactText, sanitizeDetails, scrubEvent } from "./scrub";

const UUID = "3f2b8c1e-9a4d-4e6f-8b2a-1c3d5e7f9a0b";

describe("redactText", () => {
  it.each([
    [
      "an email",
      "No user for jane.doe+shop@example.co.uk",
      "No user for [email]",
    ],
    [
      "a tracking number",
      "Tracker 1Z999AA10123456784 not found",
      "Tracker [redacted] not found",
    ],
    ["an Amazon number", "bad number TBA123456789012", "bad number [redacted]"],
    ["a phone number", "Call 8002255345 now", "Call [redacted] now"],
    [
      "a Postgres key detail",
      'duplicate key value violates unique constraint "x" Key (user_id, tracking_number)=(abc, 1Z999AA1) already exists.',
      'duplicate key value violates unique constraint "x" Key (user_id, tracking_number)=([redacted]) already exists.',
    ],
    [
      "a query string",
      "GET /auth/callback?code=s3cr3t-c0de&next=/ failed",
      "GET /auth/callback?[redacted] failed",
    ],
  ])("removes %s", (_name, input, output) => {
    expect(redactText(input)).toBe(output);
  });

  it("keeps UUIDs, short words and ordinary punctuation", () => {
    const text = `Notification ${UUID} failed: is it gone? FAKE-OFD-1 status 404`;
    expect(redactText(text)).toBe(text);
  });
});

describe("sanitizeDetails", () => {
  it("keeps ids, kinds, counts and flags", () => {
    expect(
      sanitizeDetails({
        job: "send-notification",
        notification_id: UUID,
        push_failed: 2,
        retried: true,
        missing: null,
      }),
    ).toEqual({
      job: "send-notification",
      notification_id: UUID,
      push_failed: 2,
      retried: true,
      missing: null,
    });
  });

  it("redacts free text, tracking numbers and addresses", () => {
    expect(
      sanitizeDetails({
        subject: "Your order of Red Shoes has shipped",
        tracking: "1Z999AA10123456784",
        email: "jane@example.test",
        address: "1 Main St, Springfield",
        number: Number.NaN,
      }),
    ).toEqual({
      subject: "[redacted]",
      tracking: "[redacted]",
      email: "[redacted]",
      address: "[redacted]",
      number: "[redacted]",
    });
  });

  it("drops odd keys and caps how many there are", () => {
    const many = Object.fromEntries(
      Array.from({ length: 30 }, (_, i) => [`k${i}`, i]),
    );
    expect(Object.keys(sanitizeDetails(many))).toHaveLength(20);
    expect(sanitizeDetails({ "Bad Key": 1, ok: 2 })).toEqual({ ok: 2 });
    expect(sanitizeDetails(undefined)).toEqual({});
  });
});

describe("scrubEvent", () => {
  const hostile = (): ErrorEvent => ({
    type: undefined,
    message: "Failed for jane@example.test with 1Z999AA10123456784",
    logentry: {
      message: "Lookup of %s failed",
      params: ["jane@example.test"],
    },
    request: {
      method: "POST",
      url: "https://wayfind.example/settings?code=abc123secret#frag",
      data: { email: "jane@example.test", body: "forwarded email text" },
      headers: { cookie: "sb-access-token=secret", authorization: "Bearer x" },
      cookies: { session: "secret" },
      query_string: "code=abc123secret",
      env: { REMOTE_ADDR: "203.0.113.5" },
    },
    user: { id: "u1", email: "jane@example.test", ip_address: "203.0.113.5" },
    breadcrumbs: [
      { message: "fetch https://api.resend.com to jane@example.test" },
    ],
    extra: { body: "Ship to 1 Main St" },
    tags: { kind: "client_error", note: "for jane@example.test" },
    transaction: "GET /?shipment=x",
    contexts: {
      wayfind: { job: "send-notification", subject: "Red Shoes" },
      runtime: { name: "node", version: "v24" },
      response: { headers: { "set-cookie": "secret" } },
    },
    exception: {
      values: [
        {
          type: "Error",
          value: "Insert failed for TBA123456789012 (jane@example.test)",
          stacktrace: {
            frames: [
              {
                filename: "app.js",
                lineno: 3,
                vars: { trackingNumber: "TBA123456789012" },
              },
            ],
          },
        },
      ],
    },
  });

  it("removes everything personal and keeps what helps debugging", () => {
    const event = scrubEvent(hostile());

    expect(event.user).toBeUndefined();
    expect(event.breadcrumbs).toBeUndefined();
    expect(event.extra).toBeUndefined();
    expect(event.request).toEqual({ method: "POST", url: "/settings" });
    expect(event.message).toBe("Failed for [email] with [redacted]");
    expect(event.logentry).toEqual({ message: "Lookup of %s failed" });
    expect(event.tags).toEqual({
      kind: "client_error",
      note: "for [email]",
    });
    expect(event.transaction).toBe("GET /?[redacted]");
    expect(event.contexts).toEqual({
      wayfind: { job: "send-notification", subject: "[redacted]" },
      runtime: { name: "node", version: "v24" },
    });
    const [exception] = event.exception?.values ?? [];
    expect(exception?.type).toBe("Error");
    expect(exception?.value).toBe("Insert failed for [redacted] ([email])");
    expect(exception?.stacktrace?.frames?.[0]).toEqual({
      filename: "app.js",
      lineno: 3,
    });
  });

  it("leaves no trace of the hostile values anywhere in the event", () => {
    const sent = JSON.stringify(scrubEvent(hostile()));
    for (const secret of [
      "jane@example.test",
      "1Z999AA10123456784",
      "TBA123456789012",
      "abc123secret",
      "203.0.113.5",
      "Main St",
      "forwarded email text",
      "sb-access-token",
      "Red Shoes",
    ]) {
      expect(sent).not.toContain(secret);
    }
  });

  it("copes with a bare event", () => {
    expect(scrubEvent({ type: undefined })).toEqual({ type: undefined });
  });

  it("marks a request URL it cannot parse", () => {
    const event = scrubEvent({
      type: undefined,
      request: { url: "http://[bad" },
    });
    expect(event.request).toEqual({ url: "[redacted]" });
  });
});
