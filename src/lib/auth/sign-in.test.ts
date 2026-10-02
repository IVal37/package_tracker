import type { SupabaseClient } from "@supabase/supabase-js";
import { describe, expect, it, vi } from "vitest";
import { requestMagicLink, startGoogleSignIn } from "./sign-in";

const APP_URL = "https://wayfind.example.test";

function fakeClient(overrides: {
  signInWithOtp?: unknown;
  signInWithOAuth?: unknown;
}) {
  const auth = {
    signInWithOtp: vi.fn().mockResolvedValue({ error: null }),
    signInWithOAuth: vi.fn().mockResolvedValue({ data: {}, error: null }),
    ...overrides,
  };
  return { auth } as unknown as Pick<SupabaseClient, "auth"> & {
    auth: typeof auth;
  };
}

describe("requestMagicLink", () => {
  it("sends a link whose redirect is the app's /auth/callback", async () => {
    const client = fakeClient({});
    await expect(
      requestMagicLink(client, "  User@Example.TEST ", APP_URL),
    ).resolves.toEqual({ ok: true });
    expect(client.auth.signInWithOtp).toHaveBeenCalledWith({
      email: "user@example.test",
      options: { emailRedirectTo: `${APP_URL}/auth/callback` },
    });
  });

  it.each(["", "not-an-email", "a@", "@b.test"])(
    "rejects %j without calling Supabase",
    async (email) => {
      const client = fakeClient({});
      await expect(requestMagicLink(client, email, APP_URL)).resolves.toEqual({
        ok: false,
        error: "invalid_email",
      });
      expect(client.auth.signInWithOtp).not.toHaveBeenCalled();
    },
  );

  it("reports send_failed when Supabase returns an error", async () => {
    const client = fakeClient({
      signInWithOtp: vi.fn().mockResolvedValue({ error: new Error("smtp") }),
    });
    await expect(
      requestMagicLink(client, "user@example.test", APP_URL),
    ).resolves.toEqual({ ok: false, error: "send_failed" });
  });
});

describe("startGoogleSignIn", () => {
  it("requests the google provider with the callback redirect", async () => {
    const client = fakeClient({
      signInWithOAuth: vi.fn().mockResolvedValue({
        data: { url: "https://accounts.google.test/x" },
        error: null,
      }),
    });
    await expect(startGoogleSignIn(client, APP_URL)).resolves.toEqual({
      ok: true,
      url: "https://accounts.google.test/x",
    });
    expect(client.auth.signInWithOAuth).toHaveBeenCalledWith({
      provider: "google",
      options: { redirectTo: `${APP_URL}/auth/callback` },
    });
  });

  it("fails on an error or a missing url", async () => {
    const errored = fakeClient({
      signInWithOAuth: vi
        .fn()
        .mockResolvedValue({ data: {}, error: new Error("nope") }),
    });
    await expect(startGoogleSignIn(errored, APP_URL)).resolves.toEqual({
      ok: false,
    });
    await expect(startGoogleSignIn(fakeClient({}), APP_URL)).resolves.toEqual({
      ok: false,
    });
  });
});
