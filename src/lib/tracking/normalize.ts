import { ProviderResponseError } from "./errors";
import type { NormalizedEvent } from "./types";

const DATE_ONLY = /^\d{4}-\d{2}-\d{2}$/;
const HAS_ZONE = /(Z|[+-]\d{2}(:?\d{2})?)$/i;

/**
 * Parses a provider "logistics" datetime. A value with Z or an offset is exact;
 * a value with no offset is treated as UTC; a bare date is midnight UTC.
 */
export function parseLogisticsDate(value: string): Date {
  const trimmed = value.trim();
  let iso = trimmed;
  if (DATE_ONLY.test(trimmed)) {
    iso = `${trimmed}T00:00:00Z`;
  } else if (trimmed.includes("T") && !HAS_ZONE.test(trimmed)) {
    iso = `${trimmed}Z`;
  }

  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) {
    throw new ProviderResponseError("Provider returned an unparseable date");
  }
  return date;
}

/** Drops repeated providerEventIds (first one wins), then sorts newest first. */
export function dedupeEvents(events: NormalizedEvent[]): NormalizedEvent[] {
  const seen = new Set<string>();
  const unique = events.filter((event) => {
    if (seen.has(event.providerEventId)) return false;
    seen.add(event.providerEventId);
    return true;
  });

  return unique.sort((a, b) => {
    const byTime = b.occurredAt.getTime() - a.occurredAt.getTime();
    if (byTime !== 0) return byTime;
    return (b.order ?? -Infinity) - (a.order ?? -Infinity) || 0;
  });
}

/** Trim, strip all whitespace, uppercase. Shared with the Add Package form. */
export function normalizeTrackingNumber(value: string): string {
  return value.replace(/\s+/g, "").toUpperCase();
}
