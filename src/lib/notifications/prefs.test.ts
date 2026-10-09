// @vitest-environment node
import { describe, expect, it } from "vitest";
import type { notificationSettings } from "@/lib/db/schema";
import {
  DEFAULT_PREFS,
  channelsFor,
  columnsFromPrefs,
  formatTimeOfDay,
  parseTimeOfDay,
  prefsFromRow,
  prefsSchema,
  type NotificationPrefs,
} from "./prefs";
import { NOTIFICATION_KINDS } from "./rules";

type Row = typeof notificationSettings.$inferSelect;

const row = (overrides: Partial<Row> = {}): Row => ({
  userId: "u1",
  pushOutForDelivery: true,
  pushDelivered: true,
  pushProblem: true,
  pushDelay: true,
  emailOutForDelivery: false,
  emailDelivered: true,
  emailProblem: true,
  emailDelay: false,
  quietEnabled: false,
  quietStart: 22 * 60,
  quietEnd: 7 * 60,
  timeZone: "UTC",
  updatedAt: new Date("2026-06-10T00:00:00Z"),
  ...overrides,
});

describe("defaults", () => {
  it("push for everything, email for delivered and problem, no quiet hours", () => {
    expect(DEFAULT_PREFS.push).toEqual({
      out_for_delivery: true,
      delivered: true,
      problem: true,
      delay: true,
    });
    expect(DEFAULT_PREFS.email).toEqual({
      out_for_delivery: false,
      delivered: true,
      problem: true,
      delay: false,
    });
    expect(DEFAULT_PREFS.quiet.enabled).toBe(false);
  });

  it("match a freshly inserted row's column defaults", () => {
    expect(prefsFromRow(row())).toEqual(DEFAULT_PREFS);
  });
});

describe("prefsFromRow / columnsFromPrefs", () => {
  it("returns the defaults when the user has no row, as a copy", () => {
    const prefs = prefsFromRow(null);
    expect(prefs).toEqual(DEFAULT_PREFS);
    prefs.push.delay = false;
    expect(DEFAULT_PREFS.push.delay).toBe(true);
    expect(prefsFromRow(undefined)).toEqual(DEFAULT_PREFS);
  });

  it("round-trips every field", () => {
    const stored = row({
      pushOutForDelivery: false,
      pushDelay: false,
      emailOutForDelivery: true,
      emailProblem: false,
      quietEnabled: true,
      quietStart: 23 * 60 + 30,
      quietEnd: 6 * 60,
      timeZone: "Europe/Paris",
    });
    const { userId: _userId, updatedAt: _updatedAt, ...columns } = stored;
    expect(columnsFromPrefs(prefsFromRow(stored))).toEqual(columns);
  });
});

describe("channelsFor", () => {
  it("lists the channels switched on for the kind", () => {
    expect(channelsFor(DEFAULT_PREFS, "delivered")).toEqual(["push", "email"]);
    expect(channelsFor(DEFAULT_PREFS, "out_for_delivery")).toEqual(["push"]);
  });

  it("is empty when both are off", () => {
    const off: NotificationPrefs = {
      ...DEFAULT_PREFS,
      push: { ...DEFAULT_PREFS.push, delay: false },
    };
    expect(channelsFor(off, "delay")).toEqual([]);
  });

  it("looks only at the requested kind", () => {
    const prefs: NotificationPrefs = {
      ...DEFAULT_PREFS,
      push: { ...DEFAULT_PREFS.push, problem: false },
    };
    expect(channelsFor(prefs, "problem")).toEqual(["email"]);
    expect(channelsFor(prefs, "delivered")).toEqual(["push", "email"]);
  });
});

describe("prefsSchema", () => {
  const valid = () => structuredClone(DEFAULT_PREFS);

  it("accepts the defaults and a full custom set", () => {
    expect(prefsSchema.safeParse(valid()).success).toBe(true);
    const custom = valid();
    custom.quiet = {
      enabled: true,
      start: 0,
      end: 1439,
      timeZone: "Asia/Tokyo",
    };
    expect(prefsSchema.safeParse(custom).success).toBe(true);
  });

  it("rejects a missing alert kind and an unknown one", () => {
    const missing = valid() as unknown as Record<string, unknown>;
    const push = { ...(missing.push as object) } as Record<string, unknown>;
    delete push.delay;
    expect(prefsSchema.safeParse({ ...missing, push }).success).toBe(false);

    const extra = { ...valid(), push: { ...valid().push, spam: true } };
    expect(prefsSchema.safeParse(extra).success).toBe(false);
  });

  it("rejects extra top-level fields, such as a user id", () => {
    expect(
      prefsSchema.safeParse({ ...valid(), userId: "someone-else" }).success,
    ).toBe(false);
  });

  it.each([
    ["start -1", { start: -1 }],
    ["start 1440", { start: 1440 }],
    ["end 1.5", { end: 1.5 }],
    ["unknown zone", { timeZone: "Mars/Olympus" }],
    ["empty zone", { timeZone: "" }],
    ["overlong zone", { timeZone: "A".repeat(65) }],
  ])("rejects bad quiet hours: %s", (_name, quiet) => {
    const prefs = valid();
    Object.assign(prefs.quiet, quiet);
    expect(prefsSchema.safeParse(prefs).success).toBe(false);
  });

  it("rejects non-boolean flags", () => {
    const prefs = valid() as unknown as { push: Record<string, unknown> };
    prefs.push.delivered = "yes";
    expect(prefsSchema.safeParse(prefs).success).toBe(false);
  });

  it("covers every alert kind for both channels", () => {
    for (const kind of NOTIFICATION_KINDS) {
      expect(kind in DEFAULT_PREFS.push).toBe(true);
      expect(kind in DEFAULT_PREFS.email).toBe(true);
    }
  });
});

describe("parseTimeOfDay / formatTimeOfDay", () => {
  it.each([
    ["00:00", 0],
    ["07:00", 420],
    ["22:30", 1350],
    ["23:59", 1439],
    [" 06:15 ", 375],
  ])("parses %j as %i", (text, value) => {
    expect(parseTimeOfDay(text)).toBe(value);
  });

  it.each(["24:00", "7:00", "07:60", "0700", "", "noon", "-1:00", "07:00:00"])(
    "rejects %j",
    (text) => {
      expect(parseTimeOfDay(text)).toBeNull();
    },
  );

  it("formats minutes as a zero-padded time and round-trips", () => {
    expect(formatTimeOfDay(0)).toBe("00:00");
    expect(formatTimeOfDay(1350)).toBe("22:30");
    for (const minutes of [0, 5, 420, 1350, 1439]) {
      expect(parseTimeOfDay(formatTimeOfDay(minutes))).toBe(minutes);
    }
  });
});
