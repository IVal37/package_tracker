// What the user has told us about the first-run setup. Pure, so it is unit
// tested without a database.

export type SetupState = "new" | "skipped" | "done";

export interface SetupTimestamps {
  completedAt: Date | null;
  skippedAt: Date | null;
}

/** Completed wins if both were ever set (the database allows only one). */
export function setupState(answer: SetupTimestamps): SetupState {
  if (answer.completedAt) return "done";
  if (answer.skippedAt) return "skipped";
  return "new";
}

/** The list page asks for the welcome dialog only until the user answers once. */
export function shouldPromptSetup(answer: SetupTimestamps): boolean {
  return setupState(answer) === "new";
}

// UTC, so the server and the browser agree on the day.
const dateFormat = new Intl.DateTimeFormat("en-GB", {
  day: "numeric",
  month: "short",
  year: "numeric",
  timeZone: "UTC",
});

/** "Not started", "Skipped on 30 Oct 2026" or "Completed on 30 Oct 2026". */
export function describeSetup(answer: SetupTimestamps): string {
  const state = setupState(answer);
  if (state === "done") {
    return `Completed on ${dateFormat.format(answer.completedAt!)}`;
  }
  if (state === "skipped") {
    return `Skipped on ${dateFormat.format(answer.skippedAt!)}`;
  }
  return "Not started";
}
