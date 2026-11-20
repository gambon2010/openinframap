// Fork: the ground's height at a point, from the backend (the terrain's elevations:
// web-backend/src/fork/terrain/elevations.py). Shared by the coordinates box
// (modules/coordinates) and a clicked thing's details (modules/terrain): modules don't
// import each other.
import { ELEVATION_URL } from '../config.ts'

/** "312 m" (to the metre), or "—" where there's no terrain. */
export function formatHeight(metres: number | null): string {
  return metres === null ? '—' : `${Math.round(metres)} m`
}

/** The height at a point, metres; null where there's no terrain or it can't be had
 * (the backend unreachable: callers show "—" or nothing, nothing depends on it). */
export async function heightAt(lng: number, lat: number): Promise<number | null> {
  try {
    const response = await fetch(`${ELEVATION_URL}?lon=${lng.toFixed(6)}&lat=${lat.toFixed(6)}`)
    if (!response.ok) return null
    const body = (await response.json()) as { elevation: number | null }
    return body.elevation
  } catch {
    return null
  }
}
