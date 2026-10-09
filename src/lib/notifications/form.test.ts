// @vitest-environment node
import { describe, expect, it } from "vitest";
import { FIELD, parseSettingsForm } from "./form";
import { DEFAULT_PREFS } from "./prefs";
import { NOTIFICATION_KINDS } from "./rules";

/** Form data as the browser sends it: unchecked boxes are absent. */
function form(
  fields: {
    push?: string[];
    email?: string[];
    quiet?: boolean;
    start?: string;
    end?: string;
    zone?: string;
    extra?: Record<string, string>;
  } = {},
) {
  const data = new FormData();
  for (const kind of fields.push ?? []) data.set(FIELD.push(kind), "on");
  for (const kind of fields.email ?? []) data.set(FIELD.email(kind), "on");
  if (fields.quiet) data.set(FIELD.quietEnabled, "on");
  data.set(FIELD.quietStart, fields.start ?? "22:00");
  data.set(FIELD.quietEnd, fields.end ?? "07:00");
  data.set(FIELD.timeZone, fields.zone ?? "America/Chicago");
  for (const [key, value] of Object.entries(fields.extra ?? {})) {
    data.set(key, value);
  }
  return data;
}

describe("parseSettingsForm", () => {
  it("reads checked boxes as on and missing ones as off", () => {
    const result = parseSettingsForm(
      form({
        push: ["out_for_delivery", "problem"],
        email: ["delivered"],
        quiet: true,
        start: "23:30",
        end: "06:15",
      }),
    );
    expect(result).toEqual({
      ok: true,
      prefs: {
        push: {
          out_for_delivery: true,
          delivered: false,
          problem: true,
          delay: false,
        },
        email: {
          out_for_delivery: false,
          delivered: true,
          problem: false,
          delay: false,
        },
        quiet: {
          enabled: true,
          start: 23 * 60 + 30,
          end: 6 * 60 + 15,
          timeZone: "America/Chicago",
        },
      },
    });
  });

  it("turns everything off when nothing is checked", () => {
    const result = parseSettingsForm(form());
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    for (const kind of NOTIFICATION_KINDS) {
      expect(result.prefs.push[kind]).toBe(false);
      expect(result.prefs.email[kind]).toBe(false);
    }
    expect(result.prefs.quiet.enabled).toBe(false);
  });

  it("round-trips the defaults", () => {
    const result = parseSettingsForm(
      form({
        push: NOTIFICATION_KINDS.filter((k) => DEFAULT_PREFS.push[k]),
        email: NOTIFICATION_KINDS.filter((k) => DEFAULT_PREFS.email[k]),
        quiet: DEFAULT_PREFS.quiet.enabled,
        zone: "UTC",
      }),
    );
    expect(result).toEqual({ ok: true, prefs: DEFAULT_PREFS });
  });

  it.each(["", "25:00", "7:00", "noon", "22:60"])(
    "rejects the time %j",
    (bad) => {
      for (const field of ["start", "end"] as const) {
        const result = parseSettingsForm(form({ [field]: bad }));
        expect(result).toEqual({
          ok: false,
          message: "Enter quiet hours as times, like 22:00.",
        });
      }
    },
  );

  it("rejects a missing time field", () => {
    const data = form();
    data.delete(FIELD.quietStart);
    expect(parseSettingsForm(data).ok).toBe(false);
  });

  it.each(["Mars/Olympus", "", "not a zone", "A".repeat(65)])(
    "rejects the time zone %j with a message about the zone",
    (zone) => {
      const result = parseSettingsForm(form({ zone }));
      expect(result).toEqual({
        ok: false,
        message: "That time zone isn't recognised. Pick one from the list.",
      });
    },
  );

  it("ignores fields the form does not have, such as a user id", () => {
    const result = parseSettingsForm(
      form({
        extra: {
          userId: "someone-else",
          user_id: "someone-else",
          push_bogus: "on",
          "quiet.start": "1",
        },
      }),
    );
    expect(result.ok).toBe(true);
    if (result.ok)
      expect(JSON.stringify(result.prefs)).not.toContain("someone");
  });

  it("only treats the exact value on as checked", () => {
    const data = form();
    data.set(FIELD.push("delivered"), "true");
    data.set(FIELD.push("problem"), "off");
    const result = parseSettingsForm(data);
    expect(result.ok && result.prefs.push.delivered).toBe(false);
    expect(result.ok && result.prefs.push.problem).toBe(false);
  });

  it("accepts a window that wraps midnight, and one that does not", () => {
    expect(parseSettingsForm(form({ start: "22:00", end: "07:00" })).ok).toBe(
      true,
    );
    expect(parseSettingsForm(form({ start: "13:00", end: "15:00" })).ok).toBe(
      true,
    );
  });
});
