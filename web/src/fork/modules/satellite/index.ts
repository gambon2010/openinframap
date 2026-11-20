// Fork: offline satellite imagery as the background (scripts/offline-maps.py, chosen in
// scripts/build-region.sh or scripts/offline-maps.sh). Each file (NASA Blue Marble for
// the world to zoom 8, Sentinel-2 10 m for an area or the world, aerial photos by
// country) is a raster source served by the backend (/satellite), listed by the
// scripts (the backend's /imagery: tiers.ts), read when the map opens. The satellite
// button (modules/background, services/background.ts) chooses:
//   map        the usual background map
//   satellite  imagery instead of it (place names, roads and infrastructure on top)
import type { Map } from 'maplibre-gl'
import { IMAGERY_LIST_URL, IMAGERY_URL } from '../../config.ts'
import { ForkModule } from '../../types.ts'
import { background } from '../../services/background.ts'
import { Tier, covers, tiersOf } from './tiers.ts'

const sourceId = (i: number) => `satellite_${i}`

/** The imagery there is (none if the list can't be had: the map shows without it). */
async function loadTiers(): Promise<Tier[]> {
  try {
    const response = await fetch(IMAGERY_LIST_URL)
    return response.ok ? tiersOf(await response.json(), IMAGERY_URL) : []
  } catch {
    return []
  }
}

/** Each tier's source and layer, if the map hasn't them (a new style drops them). The
 * coarsest tier has no minzoom, and none has a maxzoom: each is stretched under the
 * finer ones where they have nothing. */
function addTiers(map: Map, tiers: Tier[]) {
  tiers.forEach((tier, i) => {
    if (!map.getSource(sourceId(i)))
      map.addSource(sourceId(i), {
        type: 'raster',
        tiles: [tier.url],
        tileSize: 256,
        minzoom: tier.minzoom,
        maxzoom: tier.maxzoom,
        attribution: tier.attribution,
        ...(tier.bounds ? { bounds: tier.bounds } : {})
      })
    if (!map.getLayer(sourceId(i)))
      map.addLayer({
        id: sourceId(i),
        type: 'raster',
        source: sourceId(i),
        ...(i > 0 ? { minzoom: tier.minzoom } : {})
      })
  })
  apply(map, tiers)
}

/** Show the imagery for a mode: its layers' visibility, and where they sit. */
function apply(map: Map, tiers: Tier[]) {
  if (!tiers.length || !map.getLayer(sourceId(0))) return
  const visibility = background.mode() === 'map' ? 'none' : 'visible'
  // Right above the whole background map (upstream's layers): the fork's roads
  // (modules/roads, the lowest data layers) come over it, place names later.
  const firstData = (map.getStyle().layers ?? []).find((l) => !isBackgroundOrImagery(l.id))?.id
  tiers.forEach((_, i) => {
    map.setLayoutProperty(sourceId(i), 'visibility', visibility)
    if (firstData) map.moveLayer(sourceId(i), firstData)
  })
}

function isBackgroundOrImagery(layerId: string): boolean {
  return /^(osm_|boundaries_|satellite_)/.test(layerId)
}

/** Tell the satellite button what imagery there is, and where it covers (every tier
 * has its bounds from its file's header: a tier without is taken as covering all). */
function offer(tiers: Tier[]) {
  const imagery = tiers.every((tier) => tier.bounds) ? tiers.map((tier) => tier.bounds!) : null
  background.offerImagery({
    maxzoom: Math.max(...tiers.map((tier) => tier.maxzoom)),
    covers: async (view) => !imagery || covers(imagery, view)
  })
}

const satellite: ForkModule = {
  init: ({ map }) => {
    void loadTiers().then((tiers) => {
      if (!tiers.length) return
      offer(tiers)
      const add = () => addTiers(map, tiers)
      map.on('style.load', add)
      if (map.isStyleLoaded()) add()
      else map.once('load', add)
      background.onChange(() => apply(map, tiers))
    })
  }
}

export default satellite
