import { describe, expect, it } from "vitest";
import { z } from "zod";
import { ProviderResponseError, WebhookAuthError } from "./errors";
import { readWebhookBody } from "./webhook";

const SECRET = "test-secret";
const schema = z.object({ value: z.number() });
const authorized = new Headers({ Authorization: `Bearer ${SECRET}` });

describe("readWebhookBody", () => {
  it("returns the validated body", () => {
    expect(readWebhookBody('{"value":1}', authorized, SECRET, schema)).toEqual({
      value: 1,
    });
  });

  it("checks the secret before it looks at the body", () => {
    expect(() =>
      readWebhookBody("not json", new Headers(), SECRET, schema),
    ).toThrow(WebhookAuthError);
  });

  it("refuses a body that is not JSON", () => {
    expect(() =>
      readWebhookBody("not json", authorized, SECRET, schema),
    ).toThrow(ProviderResponseError);
  });

  it("refuses a body that fails validation", () => {
    expect(() =>
      readWebhookBody('{"value":"one"}', authorized, SECRET, schema),
    ).toThrow(ProviderResponseError);
  });
});
