import type { Ship24Tracking } from "./schemas";

/**
 * Geocodable destination text from Ship24's shipment: city, region, postcode
 * and country, in that order, skipping blanks. Null when Ship24 knows none of
 * them. The recipient's name and street address are never read.
 */
export function ship24Destination(
  shipment: Ship24Tracking["shipment"],
): string | null {
  const parts = [
    shipment.recipient?.city,
    shipment.recipient?.subdivision,
    shipment.recipient?.postCode,
    shipment.destinationCountryCode,
  ]
    .map((part) => part?.trim())
    .filter((part): part is string => !!part);

  return parts.length > 0 ? parts.join(", ") : null;
}
