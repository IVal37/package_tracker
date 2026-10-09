// @vitest-environment node
import { describe, expect, it } from "vitest";
import {
  isQuietNow,
  isValidTimeZone,
  localMinutes,
  quietHoursEnd,
  type QuietHours,
} from "./quiet-hours";

const NIGHT: QuietHours = {
  enabled: true,
  start: 22 * 60,
  end: 7 * 60,
  timeZone: "America/Chicago",
};

// June: Chicago is on daylight time, UTC-5.
const chicago = (hhmm: string, day = "10") =>
  new Date(`2026-06-${day}T${hhmm}:00-05:00`);

describe("isValidTimeZone", () => {
  it.each([
    ["UTC", true],
    ["America/Chicago", true],
    ["Asia/Kolkata", true],
    ["Mars/Olympus", false],
    ["", false],
    ["not a zone", false],
  ])("%j -> %s", (zone, valid) => {
    expect(isValidTimeZone(zone)).toBe(valid);
  });
});

describe("localMinutes", () => {
  it("reads the clock in the given zone", () => {
    const instant = new Date("2026-06-10T03:30:00Z");
    expect(localMinutes(instant, "UTC")).toBe(3 * 60 + 30);
    expect(localMinutes(instant, "America/Chicago")).toBe(22 * 60 + 30);
    expect(localMinutes(instant, "Asia/Kolkata")).toBe(9 * 60);
  });

  it("reads midnight as 0, not 24", () => {
    expect(localMinutes(new Date("2026-06-10T00:00:00Z"), "UTC")).toBe(0);
    expect(localMinutes(new Date("2026-06-10T00:05:00Z"), "UTC")).toBe(5);
  });

  it("falls back to UTC for an unknown zone instead of throwing", () => {
    expect(localMinutes(new Date("2026-06-10T03:30:00Z"), "Mars/Olympus")).toBe(
      3 * 60 + 30,
    );
  });
});

describe("isQuietNow: a window that wraps midnight (22:00 to 07:00)", () => {
  it.each([
    ["21:59", false],
    ["22:00", true],
    ["23:59", true],
    ["00:00", true],
    ["03:00", true],
    ["06:59", true],
    ["07:00", false],
    ["12:00", false],
  ])("%s -> %s", (time, quiet) => {
    expect(isQuietNow(chicago(time), NIGHT)).toBe(quiet);
  });
});

describe("isQuietNow: a window inside one day (13:00 to 15:00)", () => {
  const afternoon: QuietHours = { ...NIGHT, start: 13 * 60, end: 15 * 60 };
  it.each([
    ["12:59", false],
    ["13:00", true],
    ["14:59", true],
    ["15:00", false],
    ["23:00", false],
  ])("%s -> %s", (time, quiet) => {
    expect(isQuietNow(chicago(time), afternoon)).toBe(quiet);
  });
});

describe("isQuietNow: switched off or empty", () => {
  it("is never quiet when disabled", () => {
    expect(isQuietNow(chicago("23:00"), { ...NIGHT, enabled: false })).toBe(
      false,
    );
  });

  it("treats equal start and end as an empty window", () => {
    expect(
      isQuietNow(chicago("23:00"), { ...NIGHT, start: 600, end: 600 }),
    ).toBe(false);
  });

  it("uses the user's zone, not the server's", () => {
    // 04:00 UTC is 23:00 in Chicago (quiet) and 09:30 in Kolkata (not).
    const instant = new Date("2026-06-10T04:00:00Z");
    expect(isQuietNow(instant, NIGHT)).toBe(true);
    expect(isQuietNow(instant, { ...NIGHT, timeZone: "Asia/Kolkata" })).toBe(
      false,
    );
  });
});

describe("quietHoursEnd", () => {
  it("is null when it is not quiet", () => {
    expect(quietHoursEnd(chicago("12:00"), NIGHT)).toBeNull();
    expect(
      quietHoursEnd(chicago("23:00"), { ...NIGHT, enabled: false }),
    ).toBeNull();
  });

  it("finds the end the next morning, across midnight", () => {
    expect(quietHoursEnd(chicago("22:30"), NIGHT)?.toISOString()).toBe(
      chicago("07:00", "11").toISOString(),
    );
  });

  it("finds the end later the same morning", () => {
    expect(quietHoursEnd(chicago("02:00"), NIGHT)?.toISOString()).toBe(
      chicago("07:00").toISOString(),
    );
  });

  it("lands on the whole minute, ignoring the seconds of now", () => {
    const now = new Date("2026-06-10T03:30:45-05:00");
    expect(quietHoursEnd(now, NIGHT)?.toISOString()).toBe(
      chicago("07:00", "10").toISOString(),
    );
  });

  it("works for a window that does not wrap", () => {
    const afternoon: QuietHours = { ...NIGHT, start: 13 * 60, end: 15 * 60 };
    expect(quietHoursEnd(chicago("13:30"), afternoon)?.toISOString()).toBe(
      chicago("15:00").toISOString(),
    );
  });

  it("is always in the future and ends the quiet period", () => {
    for (let minutes = 0; minutes < 24 * 60; minutes += 37) {
      const now = new Date(Date.UTC(2026, 5, 10, 0, minutes));
      const end = quietHoursEnd(now, NIGHT);
      if (end) {
        expect(end.getTime()).toBeGreaterThan(now.getTime());
        expect(isQuietNow(end, NIGHT)).toBe(false);
        expect(localMinutes(end, NIGHT.timeZone)).toBe(NIGHT.end);
      } else {
        expect(isQuietNow(now, NIGHT)).toBe(false);
      }
    }
  });
});

describe("quietHoursEnd across daylight saving", () => {
  // US clocks jump forward 02:00 -> 03:00 on 2026-03-08 and back 02:00 -> 01:00
  // on 2026-11-01. The end must still be 07:00 on the user's clock.
  it("is 07:00 local on the night the clocks go forward", () => {
    const now = new Date("2026-03-08T05:30:00Z"); // 23:30 CST on March 7
    const end = quietHoursEnd(now, NIGHT);
    expect(end?.toISOString()).toBe("2026-03-08T12:00:00.000Z"); // 07:00 CDT
    expect(localMinutes(end!, NIGHT.timeZone)).toBe(7 * 60);
  });

  it("is 07:00 local on the night the clocks go back", () => {
    const now = new Date("2026-11-01T04:30:00Z"); // 23:30 CDT on October 31
    const end = quietHoursEnd(now, NIGHT);
    expect(end?.toISOString()).toBe("2026-11-01T13:00:00.000Z"); // 07:00 CST
    expect(localMinutes(end!, NIGHT.timeZone)).toBe(7 * 60);
  });

  it("is right when asked after the clock change in the same night", () => {
    const now = new Date("2026-03-08T10:00:00Z"); // 05:00 CDT, after the jump
    expect(quietHoursEnd(now, NIGHT)?.toISOString()).toBe(
      "2026-03-08T12:00:00.000Z",
    );
  });
});
