// Fork: a click on a status's outline, ring or casing opens the feature it's about.
// Zoomed out, a substation is drawn as a point while its status still outlines its
// area: a click inside the outline hits nothing of upstream's. The feature is found
// among what's drawn (its point, its area elsewhere on screen) and handed to the
// click router as if it had been clicked. Not drawn at all (its layer is off in the
// layer switcher): its layer is switched on, as when a search result is picked,
// and it opens once drawn.
import { LayerSwitcher } from '@russss/maplibregl-layer-switcher'
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

/** The layer switcher's entries (by id) that draw a tile layer: those whose prefix
 * starts the id of a map layer reading it. */
export function switcherLayersFor(
  sourceLayer: string,
  styleLayers: { id: string; 'source-layer'?: string }[],
  entries: { id: string; prefix: string }[]
): string[] {
  const ids = styleLayers.filter((l) => l['source-layer'] === sourceLayer).map((l) => l.id)
  return entries.filter((e) => e.prefix && ids.some((id) => id.startsWith(e.prefix))).map((e) => e.id)
}

export function clickThroughStatuses(map: Map, clickRouter: ClickRouter, layerSwitcher: LayerSwitcher) {
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

  /** The status at a point, when nothing else is hit there. */
  const statusAt = (point: { x: number; y: number }): MapGeoJSONFeature | null => {
    if (map.getZoom() < router.minZoom) return null
    const layers = routed()
    if (!layers.length || map.queryRenderedFeatures([point.x, point.y], { layers }).length) return null
    return map.queryRenderedFeatures([point.x, point.y], { layers: statusIds() })[0] ?? null
  }

  /** What's drawn of a status's feature, the nearest to a point. */
  const drawnOf = (status: MapGeoJSONFeature, point: { x: number; y: number }): MapGeoJSONFeature | null => {
    const layers = routed()
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
    const status = statusAt(e.point)
    if (!status) return
    const feature = drawnOf(status, e.point)
    if (feature) {
      router.handleClick(Object.assign(e, { features: [feature] }))
      return
    }
    // Not drawn: its layer is off. On, then opened once drawn.
    const off = switcherLayersFor(
      String(status.properties.layer),
      map.getStyle().layers as { id: string; 'source-layer'?: string }[],
      layerSwitcher.getLayers()
    ).filter((id) => !layerSwitcher._visible.includes(id))
    if (!off.length) return
    for (const id of off) layerSwitcher.setVisibility(id, true)
    layerSwitcher._updateList()
    let tries = 0
    const open = () => {
      const found = drawnOf(status, e.point)
      if (found) router.handleClick(Object.assign(e, { features: [found] }))
      else if (++tries < 5) map.once('idle', open)
    }
    map.once('idle', open)
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
      const over = statusIds().length > 0 && statusAt(e.point) !== null
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
