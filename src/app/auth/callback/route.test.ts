// @vitest-environment node
import { NextRequest } from "next/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { resetEnvCache } from "@/lib/env";
import { stubRequiredEnv } from "../../../../tests/env";

const { completeSignIn } = vi.hoisted(() => ({ completeSignIn: vi.fn() }));

vi.mock("@/lib/auth/callback", () => ({ completeSignIn }));
vi.mock("@/lib/auth/supabase-server", () => ({
  createSupabaseServerClient: async () => ({ auth: {} }),
}));
vi.mock("@/lib/db/client", () => ({ getDb: () => ({}) }));

import { GET } from "./route";

const call = (query: string) =>
  GET(new NextRequest(`http://localhost:3000/auth/callback${query}`));

beforeEach(() => {
  completeSignIn.mockReset();
  stubRequiredEnv({ APP_URL: "https://wayfind.example.test" });
  resetEnvCache();
});

afterEach(() => {
  vi.unstubAllEnvs();
  resetEnvCache();
});

describe("GET /auth/callback", () => {
  it("passes the code through and redirects home on success", async () => {
    completeSignIn.mockResolvedValue(true);
    const response = await call("?code=abc");
    expect(completeSignIn).toHaveBeenCalledWith(
      expect.objectContaining({ code: "abc" }),
    );
    expect(response.headers.get("location")).toBe(
      "https://wayfind.example.test/",
    );
  });

  it("redirects to /sign-in?error=auth when sign-in fails", async () => {
    completeSignIn.mockResolvedValue(false);
    const response = await call("");
    expect(completeSignIn).toHaveBeenCalledWith(
      expect.objectContaining({ code: null }),
    );
    expect(response.headers.get("location")).toBe(
      "https://wayfind.example.test/sign-in?error=auth",
    );
  });

  it("treats an exception as a failed sign-in", async () => {
    completeSignIn.mockRejectedValue(new Error("db down"));
    const response = await call("?code=abc");
    expect(response.headers.get("location")).toBe(
      "https://wayfind.example.test/sign-in?error=auth",
    );
  });

  it("ignores any ?next= param, so it cannot be an open redirect", async () => {
    completeSignIn.mockResolvedValue(true);
    const response = await call("?code=abc&next=https://evil.test");
    expect(response.headers.get("location")).toBe(
      "https://wayfind.example.test/",
    );
  });
});
