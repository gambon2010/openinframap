// Fork: clicking near a line selects it. Upstream's click router only takes a
// click right on a feature's pixels, and power lines are a few pixels wide. When a
// click hits nothing, the nearest line within NEAR_PIXELS is handed to the router,
// as if it had been hit (through any wrapper on it, so My layers' tools still take
// their clicks first). The pointer also turns into a hand near a line.
import { Map, MapGeoJSONFeature, MapMouseEvent, PointLike } from 'maplibre-gl'
import { ClickRouter } from '../../../click-router.ts'

const NEAR_PIXELS = 8

type Point = [number, number]

/** Distance from a point to a segment (screen pixels). */
export function segmentDistance(p: Point, a: Point, b: Point): number {
  const dx = b[0] - a[0]
  const dy = b[1] - a[1]
  const length2 = dx * dx + dy * dy
  const t = length2 ? Math.max(0, Math.min(1, ((p[0] - a[0]) * dx + (p[1] - a[1]) * dy) / length2)) : 0
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

export function selectNearLines(map: Map, clickRouter: ClickRouter) {
  const router = clickRouter as unknown as {
    handlers: Record<string, unknown>
    minZoom: number
    handleClick: (e: MapMouseEvent & { features?: MapGeoJSONFeature[] }) => void
  }
  const layers = () => Object.keys(router.handlers).filter((id) => map.getLayer(id))

  /** The nearest line within reach of a point where nothing is hit, if any. */
  const nearLine = (point: { x: number; y: number }): MapGeoJSONFeature | null => {
    if (map.getZoom() < router.minZoom) return null
    const ids = layers()
    if (!ids.length || map.queryRenderedFeatures(point as PointLike, { layers: ids }).length) return null
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

  map.on('click', (e) => {
    const feature = nearLine(e.point)
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
      const near = nearLine(e.point) !== null
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
