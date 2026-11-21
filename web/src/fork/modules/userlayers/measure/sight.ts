// Fork: a line of sight (a measurement of the kind "sight", kinds/measure.ts): whether
// the target is seen from the observer over the terrain, and the ground's profile
// between them, with the buildings and trees on it, from the backend
// (web-backend/src/fork/terrain/sight.py: curvature less refraction, as GDAL's
// viewshed). The profile is drawn by sight-chart.ts, in the split screen
// (sight-panel.ts).
import { SIGHT_URL } from '../../../config.ts'
import type { LngLat } from '../../../core/earth.ts'

/** The observer's eyes and the target above the ground, at first (GDAL's defaults
 * are 2 and 0; a person standing, a person to see). */
export const DEFAULT_OBSERVER = 2
export const DEFAULT_TARGET = 0

/** A point along the line: metres from the observer, the ground's height (null: no
 * terrain), whether the observer sees the ground there, what stands on it (metres,
 * and "building", "trees" or ""), and its top as seen from the eye (lowered for the
 * Earth's curvature less refraction: the chart draws these, as the answer used them). */
export type ProfilePoint = [
  distance: number,
  ground: number | null,
  seen: boolean,
  standing: number,
  standingKind: '' | 'building' | 'trees',
  apparent: number | null
]

export type Blocker = 'ground' | 'building' | 'trees'

export interface SightResult {
  /** null: no terrain under one of the ends. */
  target_seen: boolean | null
  /** Metres from the observer to the first surface hiding the target. */
  blocked_at: number | null
  blocked_by: Blocker | null
  /** Metres the target clears everything by (negative: hidden by that much). */
  margin: number | null
  /** The eye's height, and the target's top as seen from it (metres). */
  eye: number | null
  target_top: number | null
  profile: ProfilePoint[]
}

/** Answers asked or had, by sightKey: the card, the map and the profile ask once. */
const answers = new Map<string, Promise<SightResult | null>>()

/** A line of sight's answer, asked once for its points and heights. */
export function sightAnswer(
  from: LngLat,
  to: LngLat,
  observer: number,
  target: number
): Promise<SightResult | null> {
  const key = sightKey(from, to, observer, target)
  let answer = answers.get(key)
  if (!answer) {
    answer = fetchSight(from, to, observer, target)
    answers.set(key, answer)
    // Not kept when it failed: asked again next time (offline for a moment).
    void answer.then((found) => {
      if (!found) answers.delete(key)
    })
  }
  return answer
}

/** Where along the line a distance from the observer is (the backend samples the line
 * straight between the two points). */
export function pointAlong(from: LngLat, to: LngLat, distance: number, length: number): LngLat {
  const f = length ? distance / length : 0
  return [from[0] + (to[0] - from[0]) * f, from[1] + (to[1] - from[1]) * f]
}

/** The line of sight from the backend; null if it can't be had (offline). */
export async function fetchSight(
  from: LngLat,
  to: LngLat,
  observer: number,
  target: number
): Promise<SightResult | null> {
  const query = new URLSearchParams({
    from: `${from[0].toFixed(6)},${from[1].toFixed(6)}`,
    to: `${to[0].toFixed(6)},${to[1].toFixed(6)}`,
    observer: String(observer),
    target: String(target)
  })
  try {
    const response = await fetch(`${SIGHT_URL}?${query}`)
    return response.ok ? ((await response.json()) as SightResult) : null
  } catch {
    return null
  }
}

/** The colours a line of sight's stretches are drawn in on the map: seen, hidden
 * (as on its profile: the fork's success and error colours, ui/panel.css). */
export const SEEN_COLOUR = '#1b7a33'
export const HIDDEN_COLOUR = '#b3261e'

/** The line from observer to target cut where what's seen changes: each stretch's
 * points and whether the observer sees that ground (the backend samples the line
 * straight between the two points: a sample a fraction of the length along it is
 * that fraction of the way). Stretches without terrain are left out. */
export function sightStretches(
  from: LngLat,
  to: LngLat,
  result: SightResult
): { points: LngLat[]; seen: boolean }[] {
  const length = result.profile[result.profile.length - 1]?.[0] || 1
  const at = (distance: number) => pointAlong(from, to, distance, length)
  const stretches: { points: LngLat[]; seen: boolean }[] = []
  let current: { points: LngLat[]; seen: boolean } | null = null
  for (const [distance, ground, seen] of result.profile) {
    if (ground === null) {
      current = null
      continue
    }
    if (current && current.seen === seen) {
      current.points.push(at(distance))
      continue
    }
    // A new stretch starts where the last ended, so they meet.
    const start: LngLat[] = current ? [current.points[current.points.length - 1]] : []
    current = { points: [...start, at(distance)], seen }
    stretches.push(current)
  }
  return stretches.filter((s) => s.points.length > 1)
}

/** What a line of sight's answer depends on: its two points and the two heights. */
export function sightKey(from: LngLat, to: LngLat, observer: number, target: number): string {
  return [...from, ...to, observer, target].join(',')
}
