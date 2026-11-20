// Fork: the ground's height under the cursor, from the backend (the terrain's
// elevations: web-backend/src/fork/terrain/elevations.py), asked once the cursor rests.
import { ELEVATION_URL } from '../../config.ts'

/** How long the cursor rests before its height is asked (ms): not a request per pixel. */
export const REST_MS = 120

/** "312 m" (to the metre), or "—" where there's no terrain. */
export function formatHeight(metres: number | null): string {
  return metres === null ? '—' : `${Math.round(metres)} m`
}

/** The height at a point, metres; null where there's no terrain or it can't be had
 * (the backend unreachable: the box shows "—", nothing else depends on it). */
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

/** Calls `show` with the latest point's height once points stop coming for REST_MS;
 * an answer for a point since left behind is dropped. */
export function heightFollower(show: (text: string) => void): (lng: number, lat: number) => void {
  let timer: ReturnType<typeof setTimeout> | undefined
  let asked = 0
  return (lng, lat) => {
    clearTimeout(timer)
    timer = setTimeout(async () => {
      const ask = ++asked
      const metres = await heightAt(lng, lat)
      if (ask === asked) show(formatHeight(metres))
    }, REST_MS)
  }
}
