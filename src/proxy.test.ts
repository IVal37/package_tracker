// @vitest-environment node
import { NextRequest } from "next/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { resetEnvCache } from "@/lib/env";
import { stubRequiredEnv } from "../tests/env";

type CookieSetter = (
  cookies: { name: string; value: string; options?: object }[],
) => void;

const { getClaims, clientOptions } = vi.hoisted(() => ({
  getClaims: vi.fn(),
  clientOptions: {
    current: undefined as
      { cookies: { getAll: () => unknown; setAll: CookieSetter } } | undefined,
  },
}));

vi.mock("@supabase/ssr", () => ({
  createServerClient: (
    _url: string,
    _key: string,
    options: NonNullable<typeof clientOptions.current>,
  ) => {
    clientOptions.current = options;
    return { auth: { getClaims } };
  },
}));

import { proxy } from "./proxy";

const request = (path: string) =>
  new NextRequest(`http://localhost:3000${path}`, {
    headers: { cookie: "sb-token=abc" },
  });

beforeEach(() => {
  stubRequiredEnv();
  resetEnvCache();
  getClaims.mockReset();
});

afterEach(() => {
  vi.unstubAllEnvs();
  resetEnvCache();
});

describe("proxy", () => {
  it("lets a signed-in user through", async () => {
    getClaims.mockResolvedValue({
      data: { claims: { sub: "u1" } },
      error: null,
    });
    const response = await proxy(request("/"));
    expect(response.status).toBe(200);
    expect(response.headers.get("location")).toBeNull();
  });

  it("redirects a signed-out user to /sign-in and drops the query", async () => {
    getClaims.mockResolvedValue({ data: null, error: null });
    const response = await proxy(request("/?shipment=abc"));
    expect(response.status).toBe(307);
    expect(response.headers.get("location")).toBe(
      "http://localhost:3000/sign-in",
    );
  });

  it.each(["/sign-in", "/auth/callback"])(
    "lets a signed-out user reach the public path %s",
    async (path) => {
      getClaims.mockResolvedValue({ data: null, error: null });
      const response = await proxy(request(path));
      expect(response.status).toBe(200);
    },
  );

  it("reads cookies from the request", async () => {
    getClaims.mockResolvedValue({
      data: { claims: { sub: "u1" } },
      error: null,
    });
    await proxy(request("/"));
    expect(clientOptions.current?.cookies.getAll()).toEqual([
      { name: "sb-token", value: "abc" },
    ]);
  });

  it("writes refreshed session cookies onto the response", async () => {
    getClaims.mockImplementation(async () => {
      clientOptions.current?.cookies.setAll([
        { name: "sb-token", value: "refreshed", options: { path: "/" } },
      ]);
      return { data: { claims: { sub: "u1" } }, error: null };
    });
    const response = await proxy(request("/"));
    expect(response.cookies.get("sb-token")?.value).toBe("refreshed");
  });
});
