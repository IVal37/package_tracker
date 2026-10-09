// Reading the settings form. Pure. Browsers send an unchecked checkbox as
// nothing at all, so a missing field means "off"; the time zone and the two
// times are checked, never trusted.
import { parseTimeOfDay, prefsSchema, type NotificationPrefs } from "./prefs";
import { NOTIFICATION_KINDS } from "./rules";

export type SettingsFormState =
  | { status: "idle" }
  | { status: "saved" }
  | { status: "error"; message: string };

/** The field names the form uses, so the component and the parser agree. */
export const FIELD = {
  push: (kind: string) => `push_${kind}`,
  email: (kind: string) => `email_${kind}`,
  quietEnabled: "quiet_enabled",
  quietStart: "quiet_start",
  quietEnd: "quiet_end",
  timeZone: "time_zone",
} as const;

const checked = (formData: FormData, name: string) =>
  formData.get(name) === "on";

export type ParsedSettingsForm =
  { ok: true; prefs: NotificationPrefs } | { ok: false; message: string };

/**
 * Turns submitted form data into validated preferences, or says what is wrong.
 * Fields the form does not have (a user id, say) are not read at all.
 */
export function parseSettingsForm(formData: FormData): ParsedSettingsForm {
  const start = parseTimeOfDay(String(formData.get(FIELD.quietStart) ?? ""));
  const end = parseTimeOfDay(String(formData.get(FIELD.quietEnd) ?? ""));
  if (start === null || end === null) {
    return { ok: false, message: "Enter quiet hours as times, like 22:00." };
  }

  const flags = (field: (kind: string) => string) =>
    Object.fromEntries(
      NOTIFICATION_KINDS.map((kind) => [kind, checked(formData, field(kind))]),
    );

  const parsed = prefsSchema.safeParse({
    push: flags(FIELD.push),
    email: flags(FIELD.email),
    quiet: {
      enabled: checked(formData, FIELD.quietEnabled),
      start,
      end,
      timeZone: String(formData.get(FIELD.timeZone) ?? ""),
    },
  });
  if (!parsed.success) {
    const zoneProblem = parsed.error.issues.some((issue) =>
      issue.path.includes("timeZone"),
    );
    return {
      ok: false,
      message: zoneProblem
        ? "That time zone isn't recognised. Pick one from the list."
        : "Those settings couldn't be saved. Check them and try again.",
    };
  }
  return { ok: true, prefs: parsed.data };
}
