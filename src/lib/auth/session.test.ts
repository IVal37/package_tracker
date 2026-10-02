// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from "vitest";

const { getClaims, redirect } = vi.hoisted(() => ({
  getClaims: vi.fn(),
  redirect: vi.fn((path: string) => {
    throw new Error(`NEXT_REDIRECT ${path}`);
  }),
}));

vi.mock("./supabase-server", () => ({
  createSupabaseServerClient: async () => ({ auth: { getClaims } }),
}));
vi.mock("next/navigation", () => ({ redirect }));

import { getCurrentUser, requireUser } from "./session";

beforeEach(() => {
  vi.clearAllMocks();
});

const signedIn = {
  data: { claims: { sub: "user-1", email: "a@example.test" } },
  error: null,
};

describe("getCurrentUser", () => {
  it("returns the id and email from verified claims", async () => {
    getClaims.mockResolvedValueOnce(signedIn);
    await expect(getCurrentUser()).resolves.toEqual({
      id: "user-1",
      email: "a@example.test",
    });
  });

  it.each([
    ["an auth error", { data: null, error: new Error("bad jwt") }],
    ["no data", { data: null, error: null }],
    [
      "claims without a subject",
      { data: { claims: { email: "a@x.test" } }, error: null },
    ],
    [
      "claims without an email",
      { data: { claims: { sub: "user-1" } }, error: null },
    ],
  ])("returns null for %s", async (_label, result) => {
    getClaims.mockResolvedValueOnce(result);
    await expect(getCurrentUser()).resolves.toBeNull();
  });
});

describe("requireUser", () => {
  it("returns the user when signed in", async () => {
    getClaims.mockResolvedValueOnce(signedIn);
    await expect(requireUser()).resolves.toMatchObject({ id: "user-1" });
    expect(redirect).not.toHaveBeenCalled();
  });

  it("redirects to /sign-in when signed out", async () => {
    getClaims.mockResolvedValueOnce({ data: null, error: null });
    await expect(requireUser()).rejects.toThrow("NEXT_REDIRECT /sign-in");
    expect(redirect).toHaveBeenCalledWith("/sign-in");
  });
});
