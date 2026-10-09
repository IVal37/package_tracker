// @vitest-environment node
import { describe, expect, it } from "vitest";
import { isAllowedPushEndpoint, pushSubscriptionSchema } from "./subscription";

// 65 bytes and 16 bytes, base64url, as a browser makes them.
const P256DH = "B".repeat(87);
const AUTH = "a".repeat(22);

describe("isAllowedPushEndpoint", () => {
  it.each([
    "https://fcm.googleapis.com/fcm/send/abc:def",
    "https://updates.push.services.mozilla.com/wpush/v2/gAAAA",
    "https://wns2-par02p.notify.windows.com/w/?token=abc",
    "https://web.push.apple.com/QLhz",
    "https://googleapis.com/x",
    "https://FCM.GoogleAPIs.com/x",
    "https://fcm.googleapis.com:443/x",
  ])("accepts %s", (endpoint) => {
    expect(isAllowedPushEndpoint(endpoint)).toBe(true);
  });

  it.each([
    ["plain http", "http://fcm.googleapis.com/x"],
    ["localhost", "https://localhost/x"],
    ["a loopback address", "https://127.0.0.1/x"],
    ["a private address", "https://10.0.0.5/x"],
    ["a cloud metadata address", "https://169.254.169.254/latest/meta-data"],
    ["an internal name", "https://db.internal/x"],
    ["a look-alike suffix", "https://evilgoogleapis.com/x"],
    ["a look-alike prefix", "https://googleapis.com.evil.test/x"],
    ["an unknown host", "https://push.example.test/x"],
    ["credentials in the url", "https://user:pass@fcm.googleapis.com/x"],
    ["a custom port", "https://fcm.googleapis.com:8443/x"],
    ["a non-url", "not a url"],
    ["an empty string", ""],
    ["a javascript url", "javascript:alert(1)"],
    ["a data url", "data:text/plain,hi"],
  ])("rejects %s", (_name, endpoint) => {
    expect(isAllowedPushEndpoint(endpoint)).toBe(false);
  });
});

describe("pushSubscriptionSchema", () => {
  const valid = {
    endpoint: "https://fcm.googleapis.com/fcm/send/abc",
    keys: { p256dh: P256DH, auth: AUTH },
  };

  it("accepts what PushSubscription.toJSON() gives", () => {
    expect(pushSubscriptionSchema.parse(valid)).toEqual(valid);
    expect(
      pushSubscriptionSchema.safeParse({
        ...valid,
        expirationTime: null,
      }).success,
    ).toBe(true);
  });

  it("drops fields it does not know", () => {
    const parsed = pushSubscriptionSchema.parse({ ...valid, userId: "x" });
    expect(parsed).toEqual(valid);
  });

  it.each([
    ["no endpoint", { keys: valid.keys }],
    ["no keys", { endpoint: valid.endpoint }],
    ["no auth", { ...valid, keys: { p256dh: P256DH } }],
    ["no p256dh", { ...valid, keys: { auth: AUTH } }],
    ["a disallowed endpoint", { ...valid, endpoint: "https://evil.test/x" }],
    [
      "an over-long endpoint",
      { ...valid, endpoint: `https://fcm.googleapis.com/${"a".repeat(2100)}` },
    ],
    ["a short p256dh", { ...valid, keys: { ...valid.keys, p256dh: "abc" } }],
    [
      "a p256dh with bad characters",
      { ...valid, keys: { ...valid.keys, p256dh: "!".repeat(87) } },
    ],
    [
      "an auth that is too long",
      { ...valid, keys: { ...valid.keys, auth: "a".repeat(40) } },
    ],
    ["numbers as keys", { ...valid, keys: { p256dh: 1, auth: 2 } }],
    ["null", null],
    ["a string", "https://fcm.googleapis.com/x"],
  ])("rejects %s", (_name, input) => {
    expect(pushSubscriptionSchema.safeParse(input).success).toBe(false);
  });
});
