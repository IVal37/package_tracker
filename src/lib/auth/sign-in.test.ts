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

describe("requestMagicLink rate limit", () => {
  it("asks the limit with the cleaned-up address before sending", async () => {
    const signInWithOtp = vi.fn().mockResolvedValue({ error: null });
    const allow = vi.fn().mockResolvedValue(true);
    const result = await requestMagicLink(
      fakeClient({ signInWithOtp }),
      " Me@Example.TEST ",
      "https://app.example.test",
      allow,
    );
    expect(result).toEqual({ ok: true });
    expect(allow).toHaveBeenCalledWith("me@example.test");
    expect(allow.mock.invocationCallOrder[0]).toBeLessThan(
      signInWithOtp.mock.invocationCallOrder[0]!,
    );
  });

  it("sends nothing when the limit refuses", async () => {
    const signInWithOtp = vi.fn();
    const result = await requestMagicLink(
      fakeClient({ signInWithOtp }),
      "me@example.test",
      "https://app.example.test",
      async () => false,
    );
    expect(result).toEqual({ ok: false, error: "rate_limited" });
    expect(signInWithOtp).not.toHaveBeenCalled();
  });

  it("never asks the limit about an invalid address", async () => {
    const allow = vi.fn();
    await requestMagicLink(
      fakeClient({}),
      "not-an-email",
      "https://app.example.test",
      allow,
    );
    expect(allow).not.toHaveBeenCalled();
  });
});

describe("startGoogleSignIn", () => {
  it("requests the google provider with the callback redirect and account picker", async () => {
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
      options: {
        redirectTo: `${APP_URL}/auth/callback`,
        queryParams: { prompt: "select_account" },
      },
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
