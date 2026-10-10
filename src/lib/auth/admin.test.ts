// @vitest-environment node
import { http, HttpResponse } from "msw";
import { afterEach, describe, expect, it, vi } from "vitest";
import { resetEnvCache } from "@/lib/env";
import { stubRequiredEnv } from "../../../tests/env";
import { server } from "../../../tests/msw/server";
import { AuthAdminError, createAuthAdmin, getAuthAdmin } from "./admin";

const URL = "https://project.supabase.test";
const USER = "3f2b8c1e-9a4d-4e6f-8b2a-1c3d5e7f9a0b";

afterEach(() => {
  vi.unstubAllEnvs();
  resetEnvCache();
});

const admin = () => createAuthAdmin({ url: URL, secretKey: "sb_secret_test" });

describe("createAuthAdmin", () => {
  it("deletes the user through Supabase's admin API with the secret key", async () => {
    let seen: { auth: string | null; apikey: string | null } | null = null;
    server.use(
      http.delete(`${URL}/auth/v1/admin/users/${USER}`, ({ request }) => {
        seen = {
          auth: request.headers.get("authorization"),
          apikey: request.headers.get("apikey"),
        };
        return HttpResponse.json({});
      }),
    );

    await admin().deleteUser(USER);

    expect(seen).toEqual({
      auth: "Bearer sb_secret_test",
      apikey: "sb_secret_test",
    });
  });

  it("treats a user that is already gone as deleted", async () => {
    server.use(
      http.delete(`${URL}/auth/v1/admin/users/${USER}`, () =>
        HttpResponse.json({ msg: "User not found" }, { status: 404 }),
      ),
    );
    await expect(admin().deleteUser(USER)).resolves.toBeUndefined();
  });

  it("throws an error with the status only when Supabase refuses", async () => {
    server.use(
      http.delete(`${URL}/auth/v1/admin/users/${USER}`, () =>
        HttpResponse.json(
          { msg: "secret detail about the user" },
          { status: 500 },
        ),
      ),
    );
    const error = await admin()
      .deleteUser(USER)
      .catch((e: unknown) => e);
    expect(error).toBeInstanceOf(AuthAdminError);
    expect((error as AuthAdminError).status).toBe(500);
    expect((error as Error).message).not.toContain("secret detail");
  });
});

describe("getAuthAdmin", () => {
  it("is null without the secret key, so deletion can refuse", () => {
    stubRequiredEnv();
    resetEnvCache();
    expect(getAuthAdmin()).toBeNull();
  });

  it("is ready with the key", () => {
    stubRequiredEnv({ SUPABASE_SECRET_KEY: "sb_secret_test" });
    resetEnvCache();
    expect(getAuthAdmin()).not.toBeNull();
  });
});
