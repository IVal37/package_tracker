import { describe, expect, it } from "vitest";
import { isPublicPath } from "./paths";

describe("isPublicPath", () => {
  it.each([
    "/sign-in",
    "/account-deleted",
    "/privacy",
    "/terms",
    "/auth",
    "/auth/callback",
    "/auth/anything/else",
    "/api/webhooks/tracking",
    "/api/inngest",
    "/manifest.webmanifest",
    "/sw.js",
    "/icons/icon-192.png",
    "/icons/apple-touch-icon.png",
  ])("%s is public", (path) => {
    expect(isPublicPath(path)).toBe(true);
  });

  it.each([
    "/",
    "/settings",
    "/settings/export",
    "/admin",
    "/account-deleted/extra",
    "/privacy/extra",
    "/termsx",
    "/sign-in/extra",
    "/authors",
    "/api/shipments",
    "/api/webhooks",
    "/api/webhooksx",
    "/api/inngest/extra",
    "/sw.js.map",
    "/sw.json",
    "/manifest.webmanifest/extra",
    "/manifest",
    "/icons",
    "/iconsx/a.png",
    "/api/icons/a.png",
  ])("%s requires sign-in", (path) => {
    expect(isPublicPath(path)).toBe(false);
  });
});
