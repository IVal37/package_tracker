// @vitest-environment node
import { describe, expect, it } from "vitest";
import { verifyBearerSecret } from "./webhook-auth";

const headers = (authorization?: string) =>
  new Headers(authorization === undefined ? {} : { authorization });

describe("verifyBearerSecret", () => {
  it("accepts the exact Bearer secret", () => {
    expect(verifyBearerSecret(headers("Bearer s3cret"), "s3cret")).toBe(true);
  });

  it.each([
    ["a wrong secret", "Bearer nope!!"],
    ["a different length", "Bearer s3cret-and-more"],
    ["no Bearer prefix", "s3cret"],
    ["a different scheme", "Basic s3cret"],
    ["an empty header", ""],
  ])("rejects %s", (_label, value) => {
    expect(verifyBearerSecret(headers(value), "s3cret")).toBe(false);
  });

  it("rejects a missing header", () => {
    expect(verifyBearerSecret(headers(), "s3cret")).toBe(false);
  });

  it("never matches when the configured secret is empty", () => {
    expect(verifyBearerSecret(headers("Bearer "), "")).toBe(false);
    expect(verifyBearerSecret(headers(), "")).toBe(false);
  });
});
