import { describe, expect, it } from "vitest";
import { describeSetup, setupState, shouldPromptSetup } from "./status";

const WHEN = new Date("2026-10-30T23:30:00Z");

describe("setupState", () => {
  it("is new until an answer is stored", () => {
    expect(setupState({ completedAt: null, skippedAt: null })).toBe("new");
  });

  it("is done or skipped by whichever timestamp is set", () => {
    expect(setupState({ completedAt: WHEN, skippedAt: null })).toBe("done");
    expect(setupState({ completedAt: null, skippedAt: WHEN })).toBe("skipped");
  });

  it("treats completed as winning, should both ever be set", () => {
    expect(setupState({ completedAt: WHEN, skippedAt: WHEN })).toBe("done");
  });
});

describe("shouldPromptSetup", () => {
  it("is true only when the user has never answered", () => {
    expect(shouldPromptSetup({ completedAt: null, skippedAt: null })).toBe(
      true,
    );
    expect(shouldPromptSetup({ completedAt: WHEN, skippedAt: null })).toBe(
      false,
    );
    // Marking setup as not done stores "skipped", so the dialog stays away.
    expect(shouldPromptSetup({ completedAt: null, skippedAt: WHEN })).toBe(
      false,
    );
  });
});

describe("describeSetup", () => {
  it("says what happened and on which day (UTC)", () => {
    expect(describeSetup({ completedAt: null, skippedAt: null })).toBe(
      "Not started",
    );
    expect(describeSetup({ completedAt: WHEN, skippedAt: null })).toBe(
      "Completed on 30 Oct 2026",
    );
    expect(describeSetup({ completedAt: null, skippedAt: WHEN })).toBe(
      "Skipped on 30 Oct 2026",
    );
  });
});
