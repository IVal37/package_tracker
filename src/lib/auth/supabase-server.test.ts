// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { resetEnvCache } from "@/lib/env";
import { stubRequiredEnv } from "../../../tests/env";

type CookieOptions = {
  cookies: {
    getAll: () => unknown;
    setAll: (
      cookies: { name: string; value: string; options?: object }[],
    ) => void;
  };
};

const { cookieStore, createServerClient } = vi.hoisted(() => ({
  cookieStore: { getAll: vi.fn(), set: vi.fn() },
  createServerClient: vi.fn<
    (url: string, key: string, options: unknown) => { auth: object }
  >(() => ({ auth: {} })),
}));

vi.mock("next/headers", () => ({ cookies: async () => cookieStore }));
vi.mock("@supabase/ssr", () => ({ createServerClient }));

import { createSupabaseServerClient } from "./supabase-server";

beforeEach(() => {
  vi.clearAllMocks();
  stubRequiredEnv();
  resetEnvCache();
});

afterEach(() => {
  vi.unstubAllEnvs();
  resetEnvCache();
});

async function cookieOptions() {
  await createSupabaseServerClient();
  const options = createServerClient.mock.calls[0]?.[2] as CookieOptions;
  return options.cookies;
}

describe("createSupabaseServerClient", () => {
  it("builds the client from the server env keys", async () => {
    await createSupabaseServerClient();
    expect(createServerClient).toHaveBeenCalledWith(
      "https://project.supabase.test",
      "sb_publishable_test_key",
      expect.any(Object),
    );
  });

  it("reads cookies from the request cookie store", async () => {
    cookieStore.getAll.mockReturnValue([{ name: "a", value: "1" }]);
    const cookies = await cookieOptions();
    expect(cookies.getAll()).toEqual([{ name: "a", value: "1" }]);
  });

  it("writes refreshed cookies to the cookie store", async () => {
    const cookies = await cookieOptions();
    cookies.setAll([{ name: "a", value: "2", options: { path: "/" } }]);
    expect(cookieStore.set).toHaveBeenCalledWith("a", "2", { path: "/" });
  });

  it("ignores read-only cookie errors from Server Components", async () => {
    cookieStore.set.mockImplementation(() => {
      throw new Error("Cookies can only be modified in a Server Action");
    });
    const cookies = await cookieOptions();
    expect(() =>
      cookies.setAll([{ name: "a", value: "2", options: {} }]),
    ).not.toThrow();
  });
});
