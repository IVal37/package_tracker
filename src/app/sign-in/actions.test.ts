// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { resetEnvCache } from "@/lib/env";
import { stubRequiredEnv } from "../../../tests/env";

const { signInWithOtp, signInWithOAuth, signOutMock, redirect } = vi.hoisted(
  () => ({
    signInWithOtp: vi.fn(),
    signInWithOAuth: vi.fn(),
    signOutMock: vi.fn(),
    redirect: vi.fn((path: string) => {
      throw new Error(`NEXT_REDIRECT ${path}`);
    }),
  }),
);

vi.mock("@/lib/auth/supabase-server", () => ({
  createSupabaseServerClient: async () => ({
    auth: { signInWithOtp, signInWithOAuth, signOut: signOutMock },
  }),
}));
vi.mock("next/navigation", () => ({ redirect }));

import { signInWithEmail, signInWithGoogle, signOut } from "./actions";

const form = (email: string) => {
  const data = new FormData();
  data.set("email", email);
  return data;
};

beforeEach(() => {
  vi.clearAllMocks();
  stubRequiredEnv({ APP_URL: "https://wayfind.example.test" });
  resetEnvCache();
});

afterEach(() => {
  vi.unstubAllEnvs();
  resetEnvCache();
});

describe("signInWithEmail", () => {
  it("returns sent after emailing a link", async () => {
    signInWithOtp.mockResolvedValue({ error: null });
    await expect(
      signInWithEmail({ status: "idle" }, form("a@example.test")),
    ).resolves.toEqual({ status: "sent" });
    expect(signInWithOtp).toHaveBeenCalledWith({
      email: "a@example.test",
      options: {
        emailRedirectTo: "https://wayfind.example.test/auth/callback",
      },
    });
  });

  it("returns a message for an invalid email", async () => {
    const state = await signInWithEmail({ status: "idle" }, form("nope"));
    expect(state).toEqual({
      status: "error",
      message: "Enter a valid email address.",
    });
    expect(signInWithOtp).not.toHaveBeenCalled();
  });

  it("returns a message when sending fails", async () => {
    signInWithOtp.mockResolvedValue({ error: new Error("smtp") });
    const state = await signInWithEmail(
      { status: "idle" },
      form("a@example.test"),
    );
    expect(state.status).toBe("error");
  });

  it("treats a missing email field as invalid", async () => {
    const state = await signInWithEmail({ status: "idle" }, new FormData());
    expect(state.status).toBe("error");
  });
});

describe("signInWithGoogle", () => {
  it("redirects to the provider URL", async () => {
    signInWithOAuth.mockResolvedValue({
      data: { url: "https://accounts.google.test/x" },
      error: null,
    });
    await expect(signInWithGoogle()).rejects.toThrow(
      "NEXT_REDIRECT https://accounts.google.test/x",
    );
  });

  it("redirects back to sign-in with an error when it fails", async () => {
    signInWithOAuth.mockResolvedValue({ data: {}, error: new Error("nope") });
    await expect(signInWithGoogle()).rejects.toThrow(
      "NEXT_REDIRECT /sign-in?error=google",
    );
  });
});

describe("signOut", () => {
  it("signs out and redirects to /sign-in", async () => {
    signOutMock.mockResolvedValue({ error: null });
    await expect(signOut()).rejects.toThrow("NEXT_REDIRECT /sign-in");
    expect(signOutMock).toHaveBeenCalledOnce();
  });
});
