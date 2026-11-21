// Fork: a line of sight (a measurement of the kind "sight", kinds/measure.ts): whether
// the target is seen from the observer over the terrain, and the ground's profile
// between them, with the buildings and trees on it, from the backend
// (web-backend/src/fork/terrain/sight.py: curvature less refraction, as GDAL's
// viewshed). On the map and the chart the line is green where it passes over
// everything, yellow where only trees rise above it, red where the ground or a
// building does. The profile is drawn by
// sight-chart.ts, in the split screen (sight-panel.ts).
import { SIGHT_URL } from '../../../config.ts'
import type { LngLat } from '../../../core/earth.ts'

/** What a line of sight's answer depends on beside its two points: the eyes and the
 * target above the ground (GDAL's defaults 2 and 0: a person standing, a person to
 * see), and the heights taken where the map gives none: woods (the background map
 * has no tree heights), buildings without one (as on a two-storey house). Metres. */
export interface SightSettings {
  observer: number
  target: number
  trees: number
  buildings: number
}

export const DEFAULT_SIGHT: SightSettings = { observer: 2, target: 0, trees: 15, buildings: 8 }

/** A line of sight item's settings, its own or the defaults. */
export function sightSettingsOf(properties: Record<string, unknown>): SightSettings {
  const of = (field: keyof SightSettings) => {
    const value = Number(properties[field] ?? DEFAULT_SIGHT[field])
    return Number.isFinite(value) && value >= 0 ? value : DEFAULT_SIGHT[field]
  }
  return { observer: of('observer'), target: of('target'), trees: of('trees'), buildings: of('buildings') }
}

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
  /** Metres from the observer to the first solid thing hiding the target (the ground,
   * a building; the first trees if only trees hide it). */
  blocked_at: number | null
  blocked_by: Blocker | null
  /** Metres the eye's line to the target passes over the highest thing between
   * (negative: that thing rises above it, by that much). */
  margin: number | null
  /** The eye's height, and the target's top as seen from it (metres). */
  eye: number | null
  target_top: number | null
  /** Whether trees and buildings were added (only where the terrain is bare ground:
   * France). */
  obstacles_counted: boolean
  /** Hidden only by trees: it may still be seen. */
  through_trees: boolean
  /** How the far heights were lowered: coefficient × distance² / (2 × radius). */
  curvature: { coefficient: number; earth_radius: number }
  profile: ProfilePoint[]
}

/** Answers asked or had, by sightKey: the card, the map and the profile ask once. */
const answers = new Map<string, Promise<SightResult | null>>()

/** A line of sight's answer, asked once for its points and settings. */
export function sightAnswer(from: LngLat, to: LngLat, settings: SightSettings): Promise<SightResult | null> {
  const key = sightKey(from, to, settings)
  let answer = answers.get(key)
  if (!answer) {
    answer = fetchSight(from, to, settings)
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
  settings: SightSettings
): Promise<SightResult | null> {
  const query = new URLSearchParams({
    from: `${from[0].toFixed(6)},${from[1].toFixed(6)}`,
    to: `${to[0].toFixed(6)},${to[1].toFixed(6)}`,
    observer: String(settings.observer),
    target: String(settings.target),
    trees: String(settings.trees),
    buildings: String(settings.buildings)
  })
  try {
    const response = await fetch(`${SIGHT_URL}?${query}`)
    return response.ok ? ((await response.json()) as SightResult) : null
  } catch {
    return null
  }
}

/** The height of the eye's straight line to the target a distance along (as seen from
 * the eye, as the answer's heights; null: no terrain at an end). */
export function lineHeightAt(result: SightResult, distance: number): number | null {
  if (result.eye === null || result.target_top === null) return null
  const length = result.profile[result.profile.length - 1]?.[0] || 1
  return result.eye + ((result.target_top - result.eye) * distance) / length
}

/** Along a line of sight, where the eye's line passes: over everything ("clear"),
 * through trees only ("trees": a signal may get through, a gap may show the target),
 * or under the ground or a building ("blocked"). */
export type LineState = 'clear' | 'trees' | 'blocked'

/** The colours each is drawn in (as on its profile: the fork's success, caution and
 * error colours, ui/panel.css). */
export const LINE_COLOURS: Record<LineState, string> = {
  clear: '#1b7a33',
  trees: '#c98a00',
  blocked: '#b3261e'
}

/** Where the eye's straight line to the target passes at a sample (both as seen from
 * the eye: the answer's own heights). */
export function lineStateAt(result: SightResult, point: ProfilePoint): LineState {
  const [distance, , , standing, kind, apparent] = point
  const line = lineHeightAt(result, distance)
  if (apparent === null || line === null || apparent <= line) return 'clear'
  const solidTop = kind === 'trees' ? apparent - standing : apparent
  return solidTop <= line ? 'trees' : 'blocked'
}

/** The line from observer to target cut where its state changes: each stretch's
 * points and its state (the backend samples the line straight between the two
 * points: a sample a fraction of the length along it is that fraction of the way).
 * Stretches without terrain are left out. */
export function sightStretches(
  from: LngLat,
  to: LngLat,
  result: SightResult
): { points: LngLat[]; state: LineState }[] {
  const length = result.profile[result.profile.length - 1]?.[0] || 1
  const at = (distance: number) => pointAlong(from, to, distance, length)
  const stretches: { points: LngLat[]; state: LineState }[] = []
  let current: { points: LngLat[]; state: LineState } | null = null
  for (const point of result.profile) {
    const [distance, ground] = point
    if (ground === null) {
      current = null
      continue
    }
    const state = lineStateAt(result, point)
    if (current && current.state === state) {
      current.points.push(at(distance))
      continue
    }
    // A new stretch starts where the last ended, so they meet.
    const start: LngLat[] = current ? [current.points[current.points.length - 1]] : []
    current = { points: [...start, at(distance)], state }
    stretches.push(current)
  }
  return stretches.filter((s) => s.points.length > 1)
}

/** What a line of sight's answer depends on: its two points and its settings. */
export function sightKey(from: LngLat, to: LngLat, settings: SightSettings): string {
  return [...from, ...to, settings.observer, settings.target, settings.trees, settings.buildings].join(',')
}
