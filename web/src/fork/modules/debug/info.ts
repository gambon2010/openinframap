// Fork: what the debug box shows (index.ts), worked out from the map. Pure but for
// reading the map.
import type { Map, MapGeoJSONFeature } from 'maplibre-gl'
import { OGC_PIXEL_M, metresPerPixel } from '../../core/geo.ts'

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
  // Thousands grouped with plain spaces: 1:56 000.
  return `1:${String(rounded).replace(/\B(?=(\d{3})+(?!\d))/g, ' ')}`
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

/** What a clicked feature is, for its details while debugging: where it's drawn
 * (style layer, source, tile layer), then every property. */
export function featureRows(feature: MapGeoJSONFeature): [string, string][] {
  const where: [string, string][] = [
    ['layer', feature.layer.id],
    ['source', String(feature.source)],
    ['source-layer', feature.sourceLayer ?? '']
  ]
  const properties = Object.keys(feature.properties)
    .sort()
    .map((key): [string, string] => [key, String(feature.properties[key])])
  return [...where, ...properties].filter(([, value]) => value !== '')
}

/** A feature's page on OpenStreetMap (its osm_id: a node or way, a relation when
 * negative, as upstream's tiles give them); undefined without one. */
export function osmUrl(properties: Record<string, unknown>): string | undefined {
  const id = Number(properties['osm_id'])
  if (!Number.isFinite(id) || id === 0) return undefined
  if (id < 0) return `https://www.openstreetmap.org/relation/${-id}`
  const type = properties['is_node'] ? 'node' : 'way'
  return `https://www.openstreetmap.org/${type}/${id}`
}
