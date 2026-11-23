// Fork: the ground at a point, its height and slope, from the backend (the terrain's
// elevations: web-backend/src/fork/terrain/elevations.py). Shared by the coordinates
// box (modules/coordinates) and a clicked thing's details (modules/terrain): modules
// don't import each other.
import { ELEVATION_URL } from '../config.ts'

/** Metres above sea level and degrees of slope; null where there's no terrain. */
export interface Ground {
  elevation: number | null
  slope: number | null
}

const UNKNOWN: Ground = { elevation: null, slope: null }

/** "312 m" (to the metre), or "—" where there's no terrain. */
export function formatHeight(metres: number | null): string {
  return metres === null ? '—' : `${Math.round(metres)} m`
}

/** "19° (34 %)": degrees, and the rise per 100 m as vehicles' slopes are given; "—"
 * where there's no terrain. */
export function formatSlope(degrees: number | null): string {
  if (degrees === null) return '—'
  const percent = Math.tan((degrees * Math.PI) / 180) * 100
  return `${Math.round(degrees)}° (${Math.round(percent)} %)`
}

/** The ground at a point (unknown where there's no terrain or it can't be had: the
 * backend unreachable, callers show "—" or nothing, nothing depends on it). */
export async function groundAt(lng: number, lat: number): Promise<Ground> {
  try {
    const response = await fetch(`${ELEVATION_URL}?lon=${lng.toFixed(6)}&lat=${lat.toFixed(6)}`)
    if (!response.ok) return UNKNOWN
    return (await response.json()) as Ground
  } catch {
    return UNKNOWN
  }
}
