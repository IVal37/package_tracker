import { describe, expect, it } from "vitest";
import {
  EMAIL_RECEIVED,
  buildEmailEvents,
  emailReceivedSchema,
} from "./events";

const T = new Date("2026-06-20T12:34:56Z");

describe("buildEmailEvents", () => {
  it("makes one event per email", () => {
    const events = buildEmailEvents(["a", "b"], T);
    expect(events).toHaveLength(2);
    expect(events.map((e) => e.data)).toEqual([
      { emailId: "a" },
      { emailId: "b" },
    ]);
    expect(events.every((e) => e.name === EMAIL_RECEIVED)).toBe(true);
  });

  it("repeats an id within the same hour so a flood cannot happen", () => {
    const first = buildEmailEvents(["a"], T)[0]!.id;
    const later = buildEmailEvents(
      ["a"],
      new Date(T.getTime() + 20 * 60_000),
    )[0]!.id;
    expect(later).toBe(first);
  });

  it("uses a new id in the next hour so a stuck email can be re-queued", () => {
    const first = buildEmailEvents(["a"], T)[0]!.id;
    const next = buildEmailEvents(["a"], new Date(T.getTime() + 3_600_000))[0]!
      .id;
    expect(next).not.toBe(first);
  });

  it("differs from the id the webhook uses, so a sweep is never swallowed by it", () => {
    expect(buildEmailEvents(["a"], T)[0]!.id).not.toBe("email-a");
  });

  it("returns nothing for nothing", () => {
    expect(buildEmailEvents([], T)).toEqual([]);
  });
});

describe("emailReceivedSchema", () => {
  it("accepts an email id", () => {
    expect(emailReceivedSchema.safeParse({ emailId: "abc" }).success).toBe(
      true,
    );
  });

  it.each([{}, { emailId: "" }, { emailId: 5 }, null, "abc"])(
    "rejects %j",
    (value) => {
      expect(emailReceivedSchema.safeParse(value).success).toBe(false);
    },
  );
});
