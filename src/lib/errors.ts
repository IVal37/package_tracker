/** An error's class name, the one part of it that is safe to log or report. */
export function errorName(error: unknown, fallback = "unknown"): string {
  return error instanceof Error ? error.name : fallback;
}
