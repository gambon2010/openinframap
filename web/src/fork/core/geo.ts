// Fork: small geographic helpers shared by modules (no UI): degrees and radians, and
// how many metres a screen pixel covers at a zoom (web Mercator, 512-pixel tiles).

/** The Earth's circumference at the equator, metres (web Mercator's sphere). */
export const EARTH_CIRCUMFERENCE_M = 40075016.686
/** Pixels across a tile at zoom 0 (MapLibre's 512). */
export const TILE_PIXELS = 512

export const toRadians = (degrees: number) => (degrees * Math.PI) / 180
export const toDegrees = (radians: number) => (radians * 180) / Math.PI

/** Metres per screen pixel at a latitude and zoom. */
export function metresPerPixel(lat: number, zoom: number): number {
  return (EARTH_CIRCUMFERENCE_M * Math.cos(toRadians(lat))) / (TILE_PIXELS * 2 ** zoom)
}
