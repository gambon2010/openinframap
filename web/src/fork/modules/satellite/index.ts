// Fork: offline satellite imagery as the background (scripts/satellite.py, chosen in
// scripts/build-region.sh or scripts/satellite.sh). Each file (NASA Blue Marble for
// the world to zoom 8, Sentinel-2 10 m for an area or the world, aerial photos by
// country) is a raster source served by the `basemap` service; the scripts write
// them to VITE_SATELLITE_TIERS. Settings → Background (modules/background,
// services/background.ts) chooses:
//   map        the usual background map
//   satellite  imagery instead of it (place names and infrastructure on top)
//   hybrid     imagery with the background map's roads, railways and boundaries
import { Map, SourceSpecification } from 'maplibre-gl'
import { ForkModule } from '../../types.ts'
import { LayerSpecificationWithZIndex } from '../../../style/types.ts'
import { Bounds, background } from '../../services/background.ts'

export interface Tier {
  url: string
  minzoom: number
  maxzoom: number
  /** Its credit line (from scripts/satellite.py, written with the tier). */
  attribution: string
  /** What its file covers (from its header): the map asks it for nothing outside. */
  bounds?: Bounds
}

import { throughGate } from '../../config.ts'

/** "URL MIN MAX [W,S,E,N]|CREDIT;..." (VITE_SATELLITE_TIERS) -> tiers, coarsest first. */
export function parseTiers(value: string | undefined): Tier[] {
  if (!value) return []
  const tiers: Tier[] = []
  for (const part of value.split(';')) {
    const [tier, attribution = ''] = part.split('|')
    const [url, min, max, box] = tier.trim().split(/\s+/)
    const minzoom = Number(min)
    const maxzoom = Number(max)
    if (
      url &&
      url.includes('{z}') &&
      Number.isInteger(minzoom) &&
      Number.isInteger(maxzoom) &&
      minzoom <= maxzoom
    ) {
      const bounds = box?.split(',').map(Number)
      tiers.push({
        url: throughGate(url),
        minzoom,
        maxzoom,
        attribution: attribution.trim(),
        ...(bounds?.length === 4 && bounds.every(Number.isFinite) ? { bounds: bounds as Bounds } : {})
      })
    }
  }
  return tiers.sort((a, b) => a.minzoom - b.minzoom)
}

const TIERS = parseTiers(import.meta.env.VITE_SATELLITE_TIERS)

/** The address of a tier's TileJSON (the background map server's /<name>.json), with its bounds. */
export function tileJsonUrl(tileUrl: string): string {
  return tileUrl.replace(/\/\{z\}.*$/, '.json')
}

/** Whether any of the imagery's bounds overlap the view. */
export function covers(imagery: Bounds[], view: Bounds): boolean {
  return imagery.some(([w, s, e, n]) => w < view[2] && e > view[0] && s < view[3] && n > view[1])
}

// What the imagery covers, read once; null if it can't be told (then it's offered everywhere).
let coverage: Promise<Bounds[] | null> | undefined
function imageryBounds(): Promise<Bounds[] | null> {
  coverage ??= Promise.all(
    TIERS.map((tier) =>
      tier.bounds
        ? Promise.resolve(tier.bounds)
        : fetch(tileJsonUrl(tier.url))
            .then((r) => (r.ok ? r.json() : null))
            .then((json) => (Array.isArray(json?.bounds) ? (json.bounds as Bounds) : null))
    )
  )
    .then((bounds) => (bounds.every((b) => b) ? (bounds as Bounds[]) : null))
    .catch(() => null)
  return coverage
}

const sourceId = (i: number) => `satellite_${i}`

/** Background map layers drawn above the imagery in hybrid mode (the rest is hidden by it). */
export function isHybridOverlay(layerId: string): boolean {
  return /^osm_(roads|rail|runway|taxiway)|^boundaries/.test(layerId)
}

// The imagery there is, for the Background section (modules/background).
if (TIERS.length)
  background.offerImagery({
    maxzoom: Math.max(...TIERS.map((tier) => tier.maxzoom)),
    covers: async (view) => {
      const imagery = await imageryBounds()
      return !imagery || covers(imagery, view)
    }
  })

/** Show the imagery for a mode: its layers' visibility, and where they sit. */
function apply(map: Map) {
  if (!TIERS.length || !map.getLayer(sourceId(0))) return
  const mode = background.mode()
  const visibility = mode === 'map' ? 'none' : 'visible'
  const layers = map.getStyle().layers ?? []
  // Satellite: above the whole background map (place names come later, from the
  // labels style). Hybrid: under its roads, railways and boundaries.
  const firstOverlay = layers.find((l) => isHybridOverlay(l.id))?.id
  const firstData = layers.find((l) => !l.id.startsWith('osm_') && !l.id.startsWith('satellite_'))?.id
  const before = mode === 'hybrid' ? firstOverlay : firstData
  // Buildings would cover the imagery in hybrid mode.
  if (map.getLayer('osm_buildings'))
    map.setLayoutProperty('osm_buildings', 'visibility', mode === 'hybrid' ? 'none' : 'visible')
  TIERS.forEach((_, i) => {
    const id = sourceId(i)
    map.setLayoutProperty(id, 'visibility', visibility)
    if (before && before !== id) map.moveLayer(id, before)
  })
}

const satellite: ForkModule = {
  sources: () =>
    Object.fromEntries(
      TIERS.map((tier, i): [string, SourceSpecification] => [
        sourceId(i),
        {
          type: 'raster',
          tiles: [tier.url],
          tileSize: 256,
          minzoom: tier.minzoom,
          maxzoom: tier.maxzoom,
          attribution: tier.attribution,
          ...(tier.bounds ? { bounds: tier.bounds } : {})
        }
      ])
    ),

  // Lowest of the data layers, so right above the background map; apply() moves them.
  layers: () =>
    TIERS.map((tier, i): LayerSpecificationWithZIndex => ({
      zorder: 1,
      id: sourceId(i),
      type: 'raster',
      source: sourceId(i),
      // The coarsest tier has no minzoom, and none has a maxzoom: each is
      // stretched under the finer ones where they have nothing.
      ...(i > 0 ? { minzoom: tier.minzoom } : {}),
      layout: { visibility: background.mode() === 'map' ? 'none' : 'visible' }
    })),

  init: ({ map }) => {
    map.on('style.load', () => apply(map))
    if (map.isStyleLoaded()) apply(map)
    else map.once('load', () => apply(map))

    background.onChange(() => apply(map))
  }
}

export default satellite
