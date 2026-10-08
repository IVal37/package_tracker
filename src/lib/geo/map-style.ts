/**
 * Base map style. OpenFreeMap: free, no API key, OpenStreetMap data (credited
 * by the style's own attribution). Community-run with no SLA; see
 * docs/unresolved-issues.md for the Phase 7 follow-up.
 */
export const MAP_STYLE_URL = "https://tiles.openfreemap.org/styles/liberty";

/** Where the map opens before it has any packages to fit: roughly the USA. */
export const DEFAULT_CENTER: [number, number] = [-98, 39];
export const DEFAULT_ZOOM = 3;
