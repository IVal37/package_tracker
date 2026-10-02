import { describe, expect, it } from "vitest";
import { isPublicPath } from "./paths";

describe("isPublicPath", () => {
  it.each(["/sign-in", "/auth", "/auth/callback", "/auth/anything/else"])(
    "%s is public",
    (path) => {
      expect(isPublicPath(path)).toBe(true);
    },
  );

  it.each(["/", "/settings", "/sign-in/extra", "/authors", "/api/shipments"])(
    "%s requires sign-in",
    (path) => {
      expect(isPublicPath(path)).toBe(false);
    },
  );
});
