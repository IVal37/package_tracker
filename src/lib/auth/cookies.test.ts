// @vitest-environment node
import { describe, expect, it } from "vitest";
import { sessionCookieOptions } from "./cookies";

describe("sessionCookieOptions", () => {
  it("keeps the session out of reach of page scripts", () => {
    expect(sessionCookieOptions("https://www.wayfind.test")).toMatchObject({
      httpOnly: true,
      sameSite: "lax",
      path: "/",
    });
  });

  it("is secure on https", () => {
    expect(sessionCookieOptions("https://www.wayfind.test").secure).toBe(true);
  });

  it("is not secure on local http, so development still signs in", () => {
    expect(sessionCookieOptions("http://localhost:3000").secure).toBe(false);
  });
});
