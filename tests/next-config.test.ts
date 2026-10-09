// @vitest-environment node
import { describe, expect, it } from "vitest";
import nextConfig from "../next.config";

describe("next.config headers", async () => {
  const rules = (await nextConfig.headers?.()) ?? [];
  const headersFor = (source: string) =>
    Object.fromEntries(
      (rules.find((rule) => rule.source === source)?.headers ?? []).map(
        (header) => [header.key, header.value],
      ),
    );

  it("serves the service worker as JavaScript that is never cached", () => {
    const headers = headersFor("/sw.js");
    expect(headers["Content-Type"]).toBe(
      "application/javascript; charset=utf-8",
    );
    // A cached worker could keep an old or broken version installed.
    expect(headers["Cache-Control"]).toBe(
      "no-cache, no-store, must-revalidate",
    );
  });

  it("restricts the service worker to scripts from this site", () => {
    expect(headersFor("/sw.js")["Content-Security-Policy"]).toBe(
      "default-src 'self'; script-src 'self'",
    );
  });

  it("sets headers for the service worker only", () => {
    expect(rules.map((rule) => rule.source)).toEqual(["/sw.js"]);
  });
});
