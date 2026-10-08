// @vitest-environment node
import { http, HttpResponse } from "msw";
import { beforeEach, describe, expect, it } from "vitest";
import error401 from "../../../../tests/fixtures/ship24/error-401.json";
import error403 from "../../../../tests/fixtures/ship24/error-403-quota.json";
import trackInTransit from "../../../../tests/fixtures/ship24/track-in-transit.json";
import webhookEvents from "../../../../tests/fixtures/ship24/webhook-events.json";
import { server } from "../../../../tests/msw/server";
import {
  CONFLICT_NUMBER,
  DELIVERED_NUMBER,
  INVALID_NUMBER,
  KNOWN_TRACKER_ID,
  SEARCH_TRACKER_ID,
  VALID_NUMBER,
  ship24Handlers,
} from "../../../../tests/msw/ship24-handlers";
import {
  InvalidTrackingNumberError,
  ProviderAuthError,
  ProviderResponseError,
  ProviderUnavailableError,
  QuotaExceededError,
  RateLimitedError,
  TrackerNotFoundError,
  WebhookAuthError,
} from "../errors";
import { Ship24Provider } from "./provider";

const API_KEY = "test-api-key-DO-NOT-LEAK";
const WEBHOOK_SECRET = "test-webhook-secret-DO-NOT-LEAK";
const BASE = "https://api.ship24.com/public/v1";

const provider = new Ship24Provider({
  apiKey: API_KEY,
  webhookSecret: WEBHOOK_SECRET,
  retry: { sleep: async () => {}, random: () => 0 },
});

const hookHeaders = (secret = WEBHOOK_SECRET) =>
  new Headers({ authorization: `Bearer ${secret}` });

beforeEach(() => {
  server.use(...ship24Handlers);
});

describe("createTracking", () => {
  it("normalizes an in-transit shipment", async () => {
    const shipment = await provider.createTracking({
      trackingNumber: VALID_NUMBER,
    });

    expect(shipment.providerTrackerId).toBe(KNOWN_TRACKER_ID);
    expect(shipment.trackingNumber).toBe(VALID_NUMBER);
    expect(shipment.status).toBe("InTransit");
    expect(shipment.courier).toBe("us-post");
    expect(shipment.eta?.toISOString()).toBe("2021-03-05T17:00:00.000Z");
    expect(shipment.lastEventAt?.toISOString()).toBe(
      "2021-03-03T22:30:00.000Z",
    );
  });

  it("builds the destination from city, region, postcode and country only", async () => {
    const shipment = await provider.createTracking({
      trackingNumber: VALID_NUMBER,
    });
    expect(shipment.destination).toBe("SAN RAFAEL, CA, 94901, US");
    // The fixture's recipient name and street must never reach our model.
    expect(JSON.stringify(shipment)).not.toContain("Jane");
    expect(JSON.stringify(shipment)).not.toContain("Main Street");
  });

  it("falls back to the destination country when there is no recipient", async () => {
    const shipment = await provider.createTracking({
      trackingNumber: DELIVERED_NUMBER,
    });
    expect(shipment.destination).toBe("US");
  });

  it("returns events newest first, with offset-less and date-only dates as UTC", async () => {
    const { events } = await provider.createTracking({
      trackingNumber: VALID_NUMBER,
    });

    expect(events.map((e) => e.providerEventId)).toEqual([
      "evt-transit-3",
      "evt-transit-2",
      "evt-transit-1",
    ]);
    expect(events.map((e) => e.occurredAt.toISOString())).toEqual([
      "2021-03-03T22:30:00.000Z",
      "2021-03-02T19:24:57.000Z",
      "2021-03-01T00:00:00.000Z",
    ]);
    expect(events.map((e) => e.status)).toEqual([
      "InTransit",
      "InTransit",
      "InfoReceived",
    ]);
    expect(events[0]?.locationText).toBe("MEMPHIS TN DISTRIBUTION CENTER");
    expect(events[2]?.locationText).toBeNull();
  });

  it("maps a delivered shipment and falls back to the courier ETA", async () => {
    const shipment = await provider.createTracking({
      trackingNumber: DELIVERED_NUMBER,
    });

    expect(shipment.status).toBe("Delivered");
    expect(shipment.eta?.toISOString()).toBe("2021-03-04T18:00:00.000Z");
    expect(shipment.events.map((e) => e.occurredAt.toISOString())).toEqual([
      "2021-03-04T17:12:57.000Z",
      "2021-03-04T08:12:57.000Z",
      "2021-03-01T08:00:00.000Z",
    ]);
  });

  it("sends the bearer key, tracking number and courier hint", async () => {
    let auth: string | null = null;
    let body: unknown;
    server.use(
      http.post(`${BASE}/trackers/track`, async ({ request }) => {
        auth = request.headers.get("authorization");
        body = await request.json();
        return HttpResponse.json(trackInTransit);
      }),
    );

    await provider.createTracking({
      trackingNumber: VALID_NUMBER,
      courierHint: "us-post",
      destinationPostCode: "94901",
      destinationCountryCode: "US",
    });

    expect(auth).toBe(`Bearer ${API_KEY}`);
    expect(body).toEqual({
      trackingNumber: VALID_NUMBER,
      courierCode: ["us-post"],
      destinationPostCode: "94901",
      destinationCountryCode: "US",
    });
  });

  it("omits optional fields that were not given", async () => {
    let body: unknown;
    server.use(
      http.post(`${BASE}/trackers/track`, async ({ request }) => {
        body = await request.json();
        return HttpResponse.json({ data: { trackings: [] } });
      }),
    );

    await expect(
      provider.createTracking({ trackingNumber: VALID_NUMBER }),
    ).rejects.toBeInstanceOf(ProviderResponseError);
    expect(body).toEqual({ trackingNumber: VALID_NUMBER });
  });

  it("falls back to the search endpoint on a tracker_conflict (409)", async () => {
    const shipment = await provider.createTracking({
      trackingNumber: CONFLICT_NUMBER,
    });
    expect(shipment.providerTrackerId).toBe(SEARCH_TRACKER_ID);
  });

  it("fails if the search fallback finds nothing", async () => {
    server.use(
      http.get(`${BASE}/trackers/search/:trackingNumber/results`, () =>
        HttpResponse.json({ data: { trackings: [] } }),
      ),
    );
    await expect(
      provider.createTracking({ trackingNumber: CONFLICT_NUMBER }),
    ).rejects.toBeInstanceOf(ProviderResponseError);
  });
});

describe("error handling", () => {
  it("throws InvalidTrackingNumberError on 400 without retrying", async () => {
    await expect(
      provider.createTracking({ trackingNumber: INVALID_NUMBER }),
    ).rejects.toBeInstanceOf(InvalidTrackingNumberError);
  });

  it("throws ProviderAuthError on 401 without retrying", async () => {
    let calls = 0;
    server.use(
      http.post(`${BASE}/trackers/track`, () => {
        calls += 1;
        return HttpResponse.json(error401, { status: 401 });
      }),
    );
    await expect(
      provider.createTracking({ trackingNumber: VALID_NUMBER }),
    ).rejects.toBeInstanceOf(ProviderAuthError);
    expect(calls).toBe(1);
  });

  it("throws QuotaExceededError on 403 without retrying", async () => {
    let calls = 0;
    server.use(
      http.post(`${BASE}/trackers/track`, () => {
        calls += 1;
        return HttpResponse.json(error403, { status: 403 });
      }),
    );
    await expect(
      provider.createTracking({ trackingNumber: VALID_NUMBER }),
    ).rejects.toBeInstanceOf(QuotaExceededError);
    expect(calls).toBe(1);
  });

  it("throws TrackerNotFoundError on 404", async () => {
    await expect(
      provider.getTracking("no-such-tracker"),
    ).rejects.toBeInstanceOf(TrackerNotFoundError);
  });

  it("retries 429 and succeeds on the 3rd call", async () => {
    let calls = 0;
    server.use(
      http.post(`${BASE}/trackers/track`, async () => {
        calls += 1;
        if (calls < 3) return new HttpResponse(null, { status: 429 });
        return HttpResponse.json(trackInTransit);
      }),
    );
    const shipment = await provider.createTracking({
      trackingNumber: VALID_NUMBER,
    });
    expect(shipment.status).toBe("InTransit");
    expect(calls).toBe(3);
  });

  it("gives up with RateLimitedError after the retry cap on constant 429", async () => {
    let calls = 0;
    server.use(
      http.post(`${BASE}/trackers/track`, () => {
        calls += 1;
        return new HttpResponse(null, { status: 429 });
      }),
    );
    await expect(
      provider.createTracking({ trackingNumber: VALID_NUMBER }),
    ).rejects.toBeInstanceOf(RateLimitedError);
    expect(calls).toBe(4); // 1 attempt + 3 retries
  });

  it("retries a 503 and recovers", async () => {
    let calls = 0;
    server.use(
      http.get(`${BASE}/trackers/:trackerId/results`, async () => {
        calls += 1;
        if (calls === 1) return new HttpResponse(null, { status: 503 });
        return HttpResponse.json(trackInTransit);
      }),
    );
    const shipment = await provider.getTracking(KNOWN_TRACKER_ID);
    expect(shipment.providerTrackerId).toBe(KNOWN_TRACKER_ID);
    expect(calls).toBe(2);
  });

  it("throws ProviderUnavailableError when the network fails", async () => {
    server.use(
      http.get(`${BASE}/trackers/:trackerId/results`, () =>
        HttpResponse.error(),
      ),
    );
    await expect(provider.getTracking(KNOWN_TRACKER_ID)).rejects.toBeInstanceOf(
      ProviderUnavailableError,
    );
  });

  it("throws ProviderResponseError on an unexpected status such as 402", async () => {
    let calls = 0;
    server.use(
      http.get(`${BASE}/trackers/:trackerId/results`, () => {
        calls += 1;
        return new HttpResponse(null, { status: 402 });
      }),
    );
    await expect(provider.getTracking(KNOWN_TRACKER_ID)).rejects.toBeInstanceOf(
      ProviderResponseError,
    );
    expect(calls).toBe(1);
  });

  it("throws ProviderResponseError when the body fails schema validation", async () => {
    server.use(
      http.get(`${BASE}/trackers/:trackerId/results`, () =>
        HttpResponse.json({ data: { trackings: "nope" } }),
      ),
    );
    await expect(provider.getTracking(KNOWN_TRACKER_ID)).rejects.toBeInstanceOf(
      ProviderResponseError,
    );
  });

  it("throws ProviderResponseError when the body is not JSON", async () => {
    server.use(
      http.get(
        `${BASE}/trackers/:trackerId/results`,
        () => new HttpResponse("<html>oops</html>", { status: 200 }),
      ),
    );
    await expect(provider.getTracking(KNOWN_TRACKER_ID)).rejects.toBeInstanceOf(
      ProviderResponseError,
    );
  });

  it("throws ProviderResponseError for an unparseable event date", async () => {
    server.use(
      http.get(`${BASE}/trackers/:trackerId/results`, () =>
        HttpResponse.json({
          data: {
            trackings: [
              {
                tracker: { trackerId: "t1", trackingNumber: "TN12345" },
                shipment: { statusMilestone: "in_transit" },
                events: [
                  {
                    eventId: "e1",
                    occurrenceDatetime: "garbage",
                    statusMilestone: "in_transit",
                  },
                ],
              },
            ],
          },
        }),
      ),
    );
    await expect(provider.getTracking("t1")).rejects.toBeInstanceOf(
      ProviderResponseError,
    );
  });

  it("never leaks the API key or webhook secret in error messages", async () => {
    server.use(
      http.post(`${BASE}/trackers/track`, () =>
        HttpResponse.json(error401, { status: 401 }),
      ),
      http.get(`${BASE}/trackers/:trackerId/results`, () =>
        HttpResponse.error(),
      ),
    );
    const failures = await Promise.allSettled([
      provider.createTracking({ trackingNumber: VALID_NUMBER }),
      provider.getTracking(KNOWN_TRACKER_ID),
      provider.parseWebhook("{}", hookHeaders("wrong")),
    ]);

    for (const failure of failures) {
      expect(failure.status).toBe("rejected");
      if (failure.status === "rejected") {
        const text = `${String(failure.reason)} ${(failure.reason as Error).stack ?? ""}`;
        expect(text).not.toContain(API_KEY);
        expect(text).not.toContain(WEBHOOK_SECRET);
      }
    }
  });
});

describe("getTracking", () => {
  it("returns the same shipment as createTracking", async () => {
    const created = await provider.createTracking({
      trackingNumber: VALID_NUMBER,
    });
    const fetched = await provider.getTracking(created.providerTrackerId);
    expect(fetched).toEqual(created);
  });

  it("throws ProviderResponseError when Ship24 returns no trackings", async () => {
    server.use(
      http.get(`${BASE}/trackers/:trackerId/results`, () =>
        HttpResponse.json({ data: { trackings: [] } }),
      ),
    );
    await expect(provider.getTracking(KNOWN_TRACKER_ID)).rejects.toBeInstanceOf(
      ProviderResponseError,
    );
  });
});

describe("deleteTracking", () => {
  it("unsubscribes the tracker with PATCH isSubscribed:false", async () => {
    let method = "";
    let body: unknown;
    server.use(
      http.patch(`${BASE}/trackers/:trackerId`, async ({ request, params }) => {
        method = request.method;
        body = { ...((await request.json()) as object), id: params.trackerId };
        return HttpResponse.json({ data: {} });
      }),
    );
    await provider.deleteTracking(KNOWN_TRACKER_ID);
    expect(method).toBe("PATCH");
    expect(body).toEqual({ isSubscribed: false, id: KNOWN_TRACKER_ID });
  });

  it("throws TrackerNotFoundError for an unknown tracker", async () => {
    await expect(
      provider.deleteTracking("no-such-tracker"),
    ).rejects.toBeInstanceOf(TrackerNotFoundError);
  });
});

describe("parseWebhook", () => {
  const body = JSON.stringify(webhookEvents);

  it("accepts an authentic webhook and normalizes it", async () => {
    const shipments = await provider.parseWebhook(body, hookHeaders());
    expect(shipments).toHaveLength(1);
    expect(shipments[0]?.providerTrackerId).toBe(KNOWN_TRACKER_ID);
    expect(shipments[0]?.status).toBe("OutForDelivery");
  });

  it("de-duplicates a repeated eventId", async () => {
    const [shipment] = await provider.parseWebhook(body, hookHeaders());
    expect(shipment?.events.map((e) => e.providerEventId)).toEqual([
      "evt-hook-2",
      "evt-hook-1",
    ]);
  });

  it("rejects a wrong secret", async () => {
    await expect(
      provider.parseWebhook(body, hookHeaders("wrong-secret")),
    ).rejects.toBeInstanceOf(WebhookAuthError);
  });

  it("rejects a missing Authorization header", async () => {
    await expect(
      provider.parseWebhook(body, new Headers()),
    ).rejects.toBeInstanceOf(WebhookAuthError);
  });

  it("authenticates before parsing: bad auth with a garbage body is an auth error", async () => {
    await expect(
      provider.parseWebhook("not json", new Headers()),
    ).rejects.toBeInstanceOf(WebhookAuthError);
  });

  it("rejects an authentic but non-JSON body", async () => {
    await expect(
      provider.parseWebhook("not json", hookHeaders()),
    ).rejects.toBeInstanceOf(ProviderResponseError);
  });

  it("rejects an authentic body that fails schema validation", async () => {
    await expect(
      provider.parseWebhook(JSON.stringify({ trackings: [{}] }), hookHeaders()),
    ).rejects.toBeInstanceOf(ProviderResponseError);
  });
});
