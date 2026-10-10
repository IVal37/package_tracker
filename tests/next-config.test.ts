// @vitest-environment node
import { describe, expect, it } from "vitest";
import nextConfig from "../next.config";
import {
  MAP_ORIGIN,
  contentSecurityPolicy,
  securityHeaders,
} from "../src/lib/security/headers";

describe("next.config headers", async () => {
  const rules = (await nextConfig.headers?.()) ?? [];
  const headersFor = (source: string) =>
    Object.fromEntries(
      (rules.find((rule) => rule.source === source)?.headers ?? []).map(
        (header) => [header.key, header.value],
      ),
    );

  /** What a response for this path ends up with: later rules win per key. */
  const effective = (path: string) => {
    const result: Record<string, string> = {};
    for (const rule of rules) {
      const matches = rule.source === "/:path*" || rule.source === path;
      if (!matches) continue;
      for (const header of rule.headers) result[header.key] = header.value;
    }
    return result;
  };

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

  it("keeps the service worker's own stricter policy over the page policy", () => {
    expect(effective("/sw.js")["Content-Security-Policy"]).toBe(
      "default-src 'self'; script-src 'self'",
    );
  });

  it.each(["/", "/settings", "/sign-in", "/privacy", "/api/inngest"])(
    "sends every security header on %s",
    (path) => {
      const headers = effective(path);
      expect(headers).toMatchObject({
        "Strict-Transport-Security": "max-age=63072000; includeSubDomains",
        "X-Content-Type-Options": "nosniff",
        "X-Frame-Options": "DENY",
        "Referrer-Policy": "strict-origin-when-cross-origin",
      });
      expect(headers["Permissions-Policy"]).toContain("camera=()");
      expect(headers["Permissions-Policy"]).toContain("microphone=()");
      expect(headers["Permissions-Policy"]).toContain("geolocation=()");
      expect(headers["Content-Security-Policy"]).toContain(
        "frame-ancestors 'none'",
      );
    },
  );
});

describe("content security policy", () => {
  const parse = (policy: string) =>
    Object.fromEntries(
      policy.split("; ").map((directive) => {
        const [name, ...values] = directive.split(" ");
        return [name, values];
      }),
    );

  it("allows what the app loads and nothing else", () => {
    const csp = parse(contentSecurityPolicy({ dev: false }));
    expect(csp["default-src"]).toEqual(["'self'"]);
    expect(csp["script-src"]).toEqual(["'self'", "'unsafe-inline'"]);
    expect(csp["connect-src"]).toEqual(["'self'", MAP_ORIGIN]);
    expect(csp["img-src"]).toContain(MAP_ORIGIN);
    expect(csp["worker-src"]).toEqual(["'self'", "blob:"]);
    expect(csp["object-src"]).toEqual(["'none'"]);
    expect(csp["base-uri"]).toEqual(["'self'"]);
    expect(csp["frame-ancestors"]).toEqual(["'none'"]);
  });

  it("points the map at OpenFreeMap", () => {
    expect(MAP_ORIGIN).toBe("https://tiles.openfreemap.org");
  });

  it("never lets the browser talk to the server-side services", () => {
    const policy = contentSecurityPolicy({ dev: false });
    for (const host of [
      "supabase",
      "ship24",
      "resend",
      "anthropic",
      "inngest",
      "sentry",
    ]) {
      expect(policy).not.toContain(host);
    }
  });

  it("allows eval and the dev websocket in development only", () => {
    expect(contentSecurityPolicy({ dev: true })).toContain("'unsafe-eval'");
    expect(contentSecurityPolicy({ dev: true })).toContain("ws:");
    expect(contentSecurityPolicy({ dev: false })).not.toContain("unsafe-eval");
    expect(contentSecurityPolicy({ dev: false })).not.toContain("ws:");
  });

  it("is the same policy securityHeaders sends", () => {
    const sent = securityHeaders({ dev: false }).find(
      (header) => header.key === "Content-Security-Policy",
    );
    expect(sent?.value).toBe(contentSecurityPolicy({ dev: false }));
  });
});
