// Fork: what the debug box shows (index.ts), worked out from the map. Pure but for
// reading the map.
import type { Map, MapGeoJSONFeature } from 'maplibre-gl'
import { metresPerPixel } from '../../core/geo.ts'

/** A screen pixel in the OGC's standard (0.28 mm): what a map's scale is counted in. */
const OGC_PIXEL_M = 0.00028

export interface DebugInfo {
  zoom: string
  centre: string
  scale: string
  metresPerPixel: string
  tiles: string
  screen: string
  layers: string
  pointer: string
  under: string[]
}

/** 1:56 000-style, rounded to 3 significant digits. */
export function scaleText(metresPerPx: number): string {
  const n = metresPerPx / OGC_PIXEL_M
  const rounded = Number(n.toPrecision(3))
  return `1:${rounded.toLocaleString('fr-FR').replace(/ /g, ' ')}`
}

/** What's under the pointer: each feature's style layer (and tile layer) and id. */
export function describeFeatures(features: MapGeoJSONFeature[], max = 6): string[] {
  const lines = features.slice(0, max).map((f) => {
    const id = f.properties?.osm_id ?? f.properties?.id ?? f.id ?? ''
    const tile = f.sourceLayer && f.sourceLayer !== f.layer.id ? ` (${f.sourceLayer})` : ''
    return `${f.layer.id}${tile}${id !== '' ? ` #${id}` : ''}`
  })
  if (features.length > max) lines.push(`… ${features.length - max} more`)
  return lines
}

export function debugInfo(
  map: Map,
  pointer: { lng: number; lat: number; x: number; y: number } | null
): DebugInfo {
  const centre = map.getCenter()
  const zoom = map.getZoom()
  const mpp = metresPerPixel(centre.lat, zoom)
  const canvas = map.getCanvas()
  const style = map.getStyle()?.layers ?? []
  const shown = style.filter((l) => {
    const visible = map.getLayoutProperty(l.id, 'visibility') !== 'none'
    const inRange = (l.minzoom ?? 0) <= zoom && zoom < (l.maxzoom ?? 24)
    return visible && inRange
  }).length
  return {
    zoom: zoom.toFixed(2),
    centre: `${centre.lat.toFixed(5)}, ${centre.lng.toFixed(5)}`,
    scale: scaleText(mpp),
    metresPerPixel: mpp < 10 ? mpp.toFixed(2) : mpp.toFixed(0),
    tiles: map.areTilesLoaded() ? 'loaded' : 'loading…',
    screen: `${canvas.clientWidth}×${canvas.clientHeight} px, ×${window.devicePixelRatio}`,
    layers: `${shown} drawn of ${style.length}`,
    pointer: pointer ? `${pointer.lat.toFixed(5)}, ${pointer.lng.toFixed(5)}` : '—',
    under: pointer ? describeFeatures(map.queryRenderedFeatures([pointer.x, pointer.y])) : []
  }
}
