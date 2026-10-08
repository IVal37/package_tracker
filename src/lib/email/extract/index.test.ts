// @vitest-environment node
import { afterEach, describe, expect, it, vi } from "vitest";

const { getEnv } = vi.hoisted(() => ({ getEnv: vi.fn() }));
vi.mock("@/lib/env", () => ({ getEnv }));

import { createExtractor, getExtractor, resetExtractorCache } from "./index";

afterEach(() => {
  resetExtractorCache();
  getEnv.mockReset();
});

describe("createExtractor", () => {
  it("builds the fake extractor by default", () => {
    expect(
      createExtractor({ EMAIL_EXTRACTOR: "fake", ANTHROPIC_API_KEY: undefined })
        .name,
    ).toBe("fake");
  });

  it("builds the Claude extractor when asked and a key is set", () => {
    expect(
      createExtractor({
        EMAIL_EXTRACTOR: "claude",
        ANTHROPIC_API_KEY: "sk-ant-x",
      }).name,
    ).toBe("claude");
  });

  it("refuses to build the Claude extractor without a key, naming only the variable", () => {
    expect(() =>
      createExtractor({
        EMAIL_EXTRACTOR: "claude",
        ANTHROPIC_API_KEY: undefined,
      }),
    ).toThrowError("Invalid environment: missing ANTHROPIC_API_KEY");
  });
});

describe("getExtractor", () => {
  it("reads the env once and caches the result", () => {
    getEnv.mockReturnValue({ EMAIL_EXTRACTOR: "fake" });
    const first = getExtractor();
    expect(getExtractor()).toBe(first);
    expect(getEnv).toHaveBeenCalledTimes(1);
  });

  it("builds a fresh one after the cache is reset", () => {
    getEnv.mockReturnValue({ EMAIL_EXTRACTOR: "fake" });
    const first = getExtractor();
    resetExtractorCache();
    expect(getExtractor()).not.toBe(first);
  });
});
