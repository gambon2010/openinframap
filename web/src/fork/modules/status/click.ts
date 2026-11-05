// Fork: a click on a status's outline, ring or casing opens the feature it's about.
// Zoomed out, a substation is drawn as a point while its status still outlines its
// area: a click inside the outline hits nothing of upstream's. The feature is found
// among what's drawn (its point, its area elsewhere on screen) and handed to the
// click router as if it had been clicked.
import { Map, MapGeoJSONFeature, MapMouseEvent } from 'maplibre-gl'
import { ClickRouter } from '../../../click-router.ts'
import { statusLayers } from './map.ts'

/** Whether a drawn feature is the one a status is about (its tile layer and id). */
export function isStatusFeature(
  drawn: { sourceLayer?: string; properties: Record<string, unknown> },
  status: { layer?: unknown; id?: unknown }
): boolean {
  const id = drawn.properties['osm_id'] ?? drawn.properties['id']
  return drawn.sourceLayer === status.layer && id !== undefined && String(id) === String(status.id)
}

export function clickThroughStatuses(map: Map, clickRouter: ClickRouter) {
  const router = clickRouter as unknown as {
    handlers: Record<string, unknown>
    minZoom: number
    handleClick: (e: MapMouseEvent & { features?: MapGeoJSONFeature[] }) => void
  }
  const statusIds = () =>
    statusLayers()
      .map((l) => l.id)
      .filter((id) => map.getLayer(id))
  const routed = () => Object.keys(router.handlers).filter((id) => map.getLayer(id))

  /** The feature under a status at a point, when nothing else is hit there. */
  const behind = (point: { x: number; y: number }): MapGeoJSONFeature | null => {
    if (map.getZoom() < router.minZoom) return null
    const layers = routed()
    if (!layers.length || map.queryRenderedFeatures([point.x, point.y], { layers }).length) return null
    const status = map.queryRenderedFeatures([point.x, point.y], { layers: statusIds() })[0]
    if (!status) return null
    // Of what's drawn of it, the nearest to the click.
    let best: MapGeoJSONFeature | null = null
    let bestDistance = Infinity
    for (const f of map.queryRenderedFeatures({ layers })) {
      if (!isStatusFeature(f, status.properties)) continue
      const g = f.geometry
      const at = g.type === 'Point' ? map.project(g.coordinates as [number, number]) : null
      const distance = at ? Math.hypot(at.x - point.x, at.y - point.y) : 1e6
      if (distance < bestDistance) {
        best = f
        bestDistance = distance
      }
    }
    return best
  }

  map.on('click', (e) => {
    const feature = behind(e.point)
    if (feature) router.handleClick(Object.assign(e, { features: [feature] }))
  })

  // A hand over a status that can be clicked through.
  let hand = false
  let pending = false
  map.on('mousemove', (e) => {
    if (pending) return
    pending = true
    requestAnimationFrame(() => {
      pending = false
      const canvas = map.getCanvas()
      const over = statusIds().length > 0 && behind(e.point) !== null
      if (over && !canvas.style.cursor) {
        canvas.style.cursor = 'pointer'
        hand = true
      } else if (!over && hand) {
        if (canvas.style.cursor === 'pointer') canvas.style.cursor = ''
        hand = false
      }
    })
  })
}
