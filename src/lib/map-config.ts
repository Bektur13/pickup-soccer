/**
 * Map configuration. OpenFreeMap is free, needs no API key or signup, and
 * serves a MapLibre vector style. The style URL is overridable via
 * `VITE_MAP_STYLE` so a deployment can swap providers without code changes.
 */

/** MapLibre vector style JSON (OpenFreeMap "liberty"). */
export const MAP_STYLE_URL: string =
  import.meta.env.VITE_MAP_STYLE ?? 'https://tiles.openfreemap.org/styles/liberty'

/** Initial view: downtown Bellevue, WA. */
export const DEFAULT_CENTER = { lat: 47.6101, lng: -122.2015 }
export const DEFAULT_ZOOM = 12
