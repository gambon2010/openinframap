// Fork: clicking near a line selects it. Upstream's click router only takes a
// click right on a feature's pixels, and power lines are a few pixels wide. When a
// click hits nothing, the nearest line within NEAR_PIXELS is handed to the router,
// as if it had been hit (through any wrapper on it, so My layers' tools still take
// their clicks first). The pointer also turns into a hand near a line.
import { Map, MapGeoJSONFeature, MapMouseEvent, PointLike } from 'maplibre-gl'
import { ClickRouter } from '../../../click-router.ts'
import { clamp } from '../../core/math.ts'

const NEAR_PIXELS = 8

type Point = [number, number]

/** Distance from a point to a segment (screen pixels). */
export function segmentDistance(p: Point, a: Point, b: Point): number {
  const dx = b[0] - a[0]
  const dy = b[1] - a[1]
  const length2 = dx * dx + dy * dy
  const t = length2 ? clamp(((p[0] - a[0]) * dx + (p[1] - a[1]) * dy) / length2, 0, 1) : 0
  return Math.hypot(p[0] - (a[0] + t * dx), p[1] - (a[1] + t * dy))
}

/** Distance from a point to a line or multi-line, given in screen pixels. */
export function lineDistance(p: Point, parts: Point[][]): number {
  let best = Infinity
  for (const part of parts) {
    for (let i = 1; i < part.length; i++) best = Math.min(best, segmentDistance(p, part[i - 1], part[i]))
  }
  return best
}

function lineParts(map: Map, feature: MapGeoJSONFeature): Point[][] {
  const g = feature.geometry
  const lines = g.type === 'LineString' ? [g.coordinates] : g.type === 'MultiLineString' ? g.coordinates : []
  return lines.map((line) =>
    line.map((c) => {
      const q = map.project(c as [number, number])
      return [q.x, q.y] as Point
    })
  )
}

/** The parts of upstream's click router this file needs (it doesn't export them). */
interface Router {
  handlers: Record<string, unknown>
  minZoom: number
  handleClick: (e: MapMouseEvent & { features?: MapGeoJSONFeature[] }) => void
}

function routerOf(clickRouter: ClickRouter): Router {
  return clickRouter as unknown as Router
}

/** The map layers a click opens details for (those on the map now). */
function clickableLayers(map: Map, router: Router): string[] {
  return Object.keys(router.handlers).filter((id) => map.getLayer(id))
}

function hitsFeature(map: Map, router: Router, point: { x: number; y: number }): boolean {
  const ids = clickableLayers(map, router)
  return ids.length > 0 && map.queryRenderedFeatures(point as PointLike, { layers: ids }).length > 0
}

/** The nearest line within reach of a point where nothing is hit, if any. */
function nearLine(map: Map, router: Router, point: { x: number; y: number }): MapGeoJSONFeature | null {
  const ids = clickableLayers(map, router)
  // No layers: MapLibre would search every layer.
  if (!ids.length || map.getZoom() < router.minZoom || hitsFeature(map, router, point)) return null
  const box: [PointLike, PointLike] = [
    [point.x - NEAR_PIXELS, point.y - NEAR_PIXELS],
    [point.x + NEAR_PIXELS, point.y + NEAR_PIXELS]
  ]
  let best: MapGeoJSONFeature | null = null
  let bestDistance = NEAR_PIXELS
  for (const feature of map.queryRenderedFeatures(box, { layers: ids })) {
    if (!feature.geometry.type.endsWith('LineString')) continue
    const distance = lineDistance([point.x, point.y], lineParts(map, feature))
    if (distance <= bestDistance) {
      best = feature
      bestDistance = distance
    }
  }
  return best
}

/** Whether a click there would open nothing: no feature under it, no line within reach. */
export function nothingClickableAt(
  map: Map,
  clickRouter: ClickRouter,
  point: { x: number; y: number }
): boolean {
  const router = routerOf(clickRouter)
  return !hitsFeature(map, router, point) && nearLine(map, router, point) === null
}

export function selectNearLines(map: Map, clickRouter: ClickRouter) {
  const router = routerOf(clickRouter)

  map.on('click', (e) => {
    const feature = nearLine(map, router, e.point)
    if (feature) router.handleClick(Object.assign(e, { features: [feature] }))
  })

  // A hand near a line, like on it (only a pointer this code set is taken back).
  let hand = false
  let pending = false
  map.on('mousemove', (e) => {
    if (pending) return
    pending = true
    requestAnimationFrame(() => {
      pending = false
      const canvas = map.getCanvas()
      const near = nearLine(map, router, e.point) !== null
      if (near && !canvas.style.cursor) {
        canvas.style.cursor = 'pointer'
        hand = true
      } else if (!near && hand) {
        if (canvas.style.cursor === 'pointer') canvas.style.cursor = ''
        hand = false
      }
    })
  })
}
