// A user's notification preferences: which alerts go to which channel, and
// quiet hours. Pure. No settings row means the defaults, so nothing has to be
// written until the user changes something.
import { z } from "zod";
import type { notificationSettings } from "@/lib/db/schema";
import { isValidTimeZone, type QuietHours } from "./quiet-hours";
import { NOTIFICATION_KINDS, type NotificationKind } from "./rules";

export type Channel = "push" | "email";

export interface NotificationPrefs {
  push: Record<NotificationKind, boolean>;
  email: Record<NotificationKind, boolean>;
  quiet: QuietHours;
}

/**
 * Push for every alert (once a device is enabled); email only for the two that
 * usually need action. Quiet hours off, with 22:00 to 07:00 as the suggestion.
 */
export const DEFAULT_PREFS: NotificationPrefs = {
  push: {
    out_for_delivery: true,
    delivered: true,
    problem: true,
    delay: true,
  },
  email: {
    out_for_delivery: false,
    delivered: true,
    problem: true,
    delay: false,
  },
  quiet: { enabled: false, start: 22 * 60, end: 7 * 60, timeZone: "UTC" },
};

type SettingsRow = typeof notificationSettings.$inferSelect;
export type SettingsColumns = Omit<SettingsRow, "userId" | "updatedAt">;

/** Preferences from a stored row; the defaults when the user has none. */
export function prefsFromRow(row: SettingsRow | null | undefined) {
  if (!row) return structuredClone(DEFAULT_PREFS);
  return {
    push: {
      out_for_delivery: row.pushOutForDelivery,
      delivered: row.pushDelivered,
      problem: row.pushProblem,
      delay: row.pushDelay,
    },
    email: {
      out_for_delivery: row.emailOutForDelivery,
      delivered: row.emailDelivered,
      problem: row.emailProblem,
      delay: row.emailDelay,
    },
    quiet: {
      enabled: row.quietEnabled,
      start: row.quietStart,
      end: row.quietEnd,
      timeZone: row.timeZone,
    },
  } satisfies NotificationPrefs;
}

/** The columns to store for these preferences. */
export function columnsFromPrefs(prefs: NotificationPrefs): SettingsColumns {
  return {
    pushOutForDelivery: prefs.push.out_for_delivery,
    pushDelivered: prefs.push.delivered,
    pushProblem: prefs.push.problem,
    pushDelay: prefs.push.delay,
    emailOutForDelivery: prefs.email.out_for_delivery,
    emailDelivered: prefs.email.delivered,
    emailProblem: prefs.email.problem,
    emailDelay: prefs.email.delay,
    quietEnabled: prefs.quiet.enabled,
    quietStart: prefs.quiet.start,
    quietEnd: prefs.quiet.end,
    timeZone: prefs.quiet.timeZone,
  };
}

/** Which channels this user wants this kind of alert on. */
export function channelsFor(
  prefs: NotificationPrefs,
  kind: NotificationKind,
): Channel[] {
  const channels: Channel[] = [];
  if (prefs.push[kind]) channels.push("push");
  if (prefs.email[kind]) channels.push("email");
  return channels;
}

const minutes = z.number().int().min(0).max(1439);
const kindFlags = z.strictObject(
  Object.fromEntries(NOTIFICATION_KINDS.map((kind) => [kind, z.boolean()])) as {
    [K in NotificationKind]: z.ZodBoolean;
  },
);

/** The shape a settings save must have; anything else is rejected. */
export const prefsSchema = z.strictObject({
  push: kindFlags,
  email: kindFlags,
  quiet: z.strictObject({
    enabled: z.boolean(),
    start: minutes,
    end: minutes,
    timeZone: z
      .string()
      .min(1)
      .max(64)
      .refine(isValidTimeZone, "unknown time zone"),
  }),
});

/** "22:30" to 1350. Null for anything that is not a time of day. */
export function parseTimeOfDay(value: string): number | null {
  const match = /^([01]\d|2[0-3]):([0-5]\d)$/.exec(value.trim());
  return match ? Number(match[1]) * 60 + Number(match[2]) : null;
}

/** 1350 to "22:30". */
export function formatTimeOfDay(totalMinutes: number): string {
  const hours = Math.floor(totalMinutes / 60);
  const mins = totalMinutes % 60;
  return `${String(hours).padStart(2, "0")}:${String(mins).padStart(2, "0")}`;
}
