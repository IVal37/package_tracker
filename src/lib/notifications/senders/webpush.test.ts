// @vitest-environment node
import { createECDH, randomBytes } from "node:crypto";
import { http, HttpResponse } from "msw";
import webpush from "web-push";
import { describe, expect, it, vi } from "vitest";
import { server } from "../../../../tests/msw/server";
import { SendError, type PushPayload, type PushTarget } from "./types";
import { PUSH_TTL_SECONDS, WebPushSender } from "./webpush";

const vapid = webpush.generateVAPIDKeys();
const options = {
  publicKey: vapid.publicKey,
  privateKey: vapid.privateKey,
  subject: "mailto:ops@example.test",
};

/** A real subscription key pair, as a browser would make. */
function subscription(endpoint: string): PushTarget {
  const ecdh = createECDH("prime256v1");
  ecdh.generateKeys();
  return {
    endpoint,
    p256dh: ecdh.getPublicKey().toString("base64url"),
    auth: randomBytes(16).toString("base64url"),
  };
}

const payload: PushPayload = {
  title: "Delivered: Merino socks",
  body: "Left at front door · MEMPHIS, TN",
  url: "https://wayfind.example.test/?shipment=11111111-1111-4111-8111-111111111111",
  tag: "shipment-11111111-1111-4111-8111-111111111111",
};

const ENDPOINT = "https://push.example.test/send/abc123";

describe("WebPushSender (real web-push, mocked push service)", () => {
  const sender = new WebPushSender(options);

  it("posts an encrypted, VAPID-signed message and reports sent", async () => {
    let seen: Request | undefined;
    let body = "";
    server.use(
      http.post(ENDPOINT, async ({ request }) => {
        seen = request.clone();
        body = Buffer.from(await request.arrayBuffer()).toString("latin1");
        return new HttpResponse(null, { status: 201 });
      }),
    );

    await expect(sender.send(subscription(ENDPOINT), payload)).resolves.toBe(
      "sent",
    );

    expect(seen?.headers.get("content-encoding")).toBe("aes128gcm");
    expect(seen?.headers.get("ttl")).toBe(String(PUSH_TTL_SECONDS));
    expect(seen?.headers.get("authorization")).toMatch(/^vapid t=.+, k=.+/);
    // The payload is encrypted: the plain text must not be on the wire.
    expect(body).not.toContain("Merino socks");
    expect(body).not.toContain("MEMPHIS");
  });

  it("reports gone for 404 and 410, so the caller can delete the subscription", async () => {
    for (const status of [404, 410]) {
      server.use(http.post(ENDPOINT, () => new HttpResponse(null, { status })));
      await expect(sender.send(subscription(ENDPOINT), payload)).resolves.toBe(
        "gone",
      );
    }
  });

  it.each([429, 500, 502, 503])(
    "throws a retryable error for %i",
    async (status) => {
      server.use(
        http.post(ENDPOINT, () => new HttpResponse("busy", { status })),
      );
      const error = await sender
        .send(subscription(ENDPOINT), payload)
        .catch((e: unknown) => e);
      expect(error).toBeInstanceOf(SendError);
      expect(error).toMatchObject({ retryable: true, status });
    },
  );

  it.each([400, 401, 403, 413])(
    "throws a permanent error for %i",
    async (status) => {
      server.use(http.post(ENDPOINT, () => new HttpResponse("no", { status })));
      const error = await sender
        .send(subscription(ENDPOINT), payload)
        .catch((e: unknown) => e);
      expect(error).toBeInstanceOf(SendError);
      expect(error).toMatchObject({ retryable: false, status });
    },
  );

  it("treats a network failure as retryable", async () => {
    server.use(http.post(ENDPOINT, () => HttpResponse.error()));
    const error = await sender
      .send(subscription(ENDPOINT), payload)
      .catch((e: unknown) => e);
    expect(error).toBeInstanceOf(SendError);
    expect(error).toMatchObject({ retryable: true, status: null });
  });

  it("never puts the endpoint or the service's answer in an error message", async () => {
    server.use(
      http.post(
        ENDPOINT,
        () => new HttpResponse(`bad token for ${ENDPOINT}`, { status: 403 }),
      ),
    );
    const error = (await sender
      .send(subscription(ENDPOINT), payload)
      .catch((e: unknown) => e)) as Error;
    expect(error.message).toBe("Push service answered 403");
    expect(error.message).not.toContain("push.example.test");
  });
});

describe("WebPushSender (replaced web-push function)", () => {
  const target = subscription(ENDPOINT);

  it("hands over the subscription, the JSON payload and the VAPID details", async () => {
    const send = vi.fn(async () => ({
      statusCode: 201,
      body: "",
      headers: {},
    }));
    const sender = new WebPushSender(options, send as never);

    await sender.send(target, payload);

    expect(send).toHaveBeenCalledOnce();
    const [sub, data, opts] = send.mock.calls[0] as unknown as [
      { endpoint: string; keys: { p256dh: string; auth: string } },
      string,
      Record<string, unknown>,
    ];
    expect(sub).toEqual({
      endpoint: ENDPOINT,
      keys: { p256dh: target.p256dh, auth: target.auth },
    });
    expect(JSON.parse(data)).toEqual(payload);
    expect(opts).toMatchObject({
      vapidDetails: options,
      TTL: PUSH_TTL_SECONDS,
      urgency: "normal",
    });
  });

  it("treats a thrown non-HTTP error as retryable and names only its type", async () => {
    const send = vi.fn(async () => {
      throw new TypeError(`connect ECONNREFUSED ${ENDPOINT}`);
    });
    const sender = new WebPushSender(options, send as never);

    const error = (await sender
      .send(target, payload)
      .catch((e: unknown) => e)) as SendError;

    expect(error).toBeInstanceOf(SendError);
    expect(error.retryable).toBe(true);
    expect(error.message).toBe("Push could not be sent (TypeError)");
    expect(error.message).not.toContain("push.example.test");
  });
});
