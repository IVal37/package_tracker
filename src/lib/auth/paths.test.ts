import { describe, expect, it } from "vitest";
import { isPublicPath } from "./paths";

describe("isPublicPath", () => {
  it.each([
    "/sign-in",
    "/auth",
    "/auth/callback",
    "/auth/anything/else",
    "/api/webhooks/tracking",
    "/api/inngest",
  ])("%s is public", (path) => {
    expect(isPublicPath(path)).toBe(true);
  });

  it.each([
    "/",
    "/settings",
    "/sign-in/extra",
    "/authors",
    "/api/shipments",
    "/api/webhooks",
    "/api/webhooksx",
    "/api/inngest/extra",
  ])("%s requires sign-in", (path) => {
    expect(isPublicPath(path)).toBe(false);
  });
});
