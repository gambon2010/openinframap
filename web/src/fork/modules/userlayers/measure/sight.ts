// Fork: a line of sight (a measurement of the kind "sight", kinds/measure.ts): whether
// the target is seen from the observer over the terrain, and the ground's profile
// between them, from the backend (web-backend/src/fork/terrain/sight.py: curvature
// less refraction, as GDAL's viewshed). The profile is drawn as a small SVG: one
// polygon a chart library would only wrap.
import { svg } from 'redom'
import { SIGHT_URL } from '../../../config.ts'
import type { LngLat } from '../../../core/earth.ts'

/** The observer's eyes and the target above the ground, at first (GDAL's defaults
 * are 2 and 0; a person standing, a person to see). */
export const DEFAULT_OBSERVER = 2
export const DEFAULT_TARGET = 0

/** A point along the line: metres from the observer, the ground's height (null: no
 * terrain), and whether the observer sees it. */
export type ProfilePoint = [distance: number, ground: number | null, seen: boolean]

export interface SightResult {
  /** null: no terrain under one of the ends. */
  target_seen: boolean | null
  /** Metres from the observer to the first ground hiding the target. */
  blocked_at: number | null
  profile: ProfilePoint[]
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

const WIDTH = 300
const HEIGHT = 90
const PAD = 4

/** The profile: the ground as a filled shape, seen stretches green and hidden ones
 * red along its top, the eye's line to the target dashed (drawn straight over the
 * ground as measured: on long lines the Earth's curvature, which the backend counts,
 * makes the difference). */
export function profileSvg(result: SightResult, observer: number, target: number): SVGElement {
  const known = result.profile.filter((p): p is [number, number, boolean] => p[1] !== null)
  const length = result.profile[result.profile.length - 1]?.[0] || 1
  const eye = (known[0]?.[1] ?? 0) + observer
  const top = (known[known.length - 1]?.[1] ?? 0) + target
  const heights = [...known.map((p) => p[1]), eye, top]
  const low = Math.min(...heights)
  const high = Math.max(...heights)
  const x = (d: number) => PAD + (d / length) * (WIDTH - 2 * PAD)
  const y = (h: number) => HEIGHT - PAD - ((h - low) / (high - low || 1)) * (HEIGHT - 2 * PAD)
  const ground = known.map(([d, h]) => `${x(d)},${y(h)}`).join(' ')
  const shape = svg('polygon', {
    points: `${x(0)},${HEIGHT - PAD} ${ground} ${x(length)},${HEIGHT - PAD}`,
    class: 'oim-ul-sight-ground'
  })
  const stretches = known.slice(1).map(([d, h, seen], i) =>
    svg('line', {
      x1: x(known[i][0]),
      y1: y(known[i][1]),
      x2: x(d),
      y2: y(h),
      class: seen ? 'oim-ul-sight-seen' : 'oim-ul-sight-hidden'
    })
  )
  const ray = svg('line', { x1: x(0), y1: y(eye), x2: x(length), y2: y(top), class: 'oim-ul-sight-ray' })
  return svg(
    'svg.oim-ul-sight-profile',
    { viewBox: `0 0 ${WIDTH} ${HEIGHT}`, role: 'img' },
    shape,
    ...stretches,
    ray
  )
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
  const at = (distance: number): LngLat => {
    const f = distance / length
    return [from[0] + (to[0] - from[0]) * f, from[1] + (to[1] - from[1]) * f]
  }
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
