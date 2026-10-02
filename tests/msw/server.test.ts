import { http, HttpResponse } from "msw";
import { describe, expect, it } from "vitest";
import { server } from "./server";

describe("msw server", () => {
  it("serves registered handlers", async () => {
    server.use(
      http.get("https://example.test/ping", () =>
        HttpResponse.json({ ok: true }),
      ),
    );
    const res = await fetch("https://example.test/ping");
    expect(await res.json()).toEqual({ ok: true });
  });

  it("rejects requests with no handler", async () => {
    await expect(fetch("https://example.test/unhandled")).rejects.toThrow();
  });
});
