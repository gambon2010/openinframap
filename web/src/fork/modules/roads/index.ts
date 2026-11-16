// Fork: roads, railways and borders, drawn by the fork in every mode, so the same
// ones show at each zoom over the map and over imagery ("satellite with roads"); only
// their colours change (layers.ts). Not in "satellite" (imagery with place names
// only). Upstream's own road, railway and border layers are hidden: they'd be a
// second set, with other zooms. Street names turn white on a dark halo over imagery.
import type { Map } from 'maplibre-gl'
import { background, followBackground } from '../../services/background.ts'
import { ForkModule } from '../../types.ts'
import { isRoadLayer, roadLayers } from './layers.ts'
import { NAME_COLOUR, NAME_HALO_COLOUR, NAME_HALO_WIDTH } from './roads.constants.ts'

const ROADS = roadLayers()

/** Upstream's roads, railways and borders (its piers stay: they're drawn as ground). */
export function isUpstreamRoadLayer(layerId: string): boolean {
  return /^osm_roads_(?!pier)|^osm_rail|^boundaries_country$/.test(layerId)
}

/** Our roads shown but in "satellite"; upstream's never. */
function showRoads(map: Map) {
  const ours = background.mode() === 'satellite' ? 'none' : 'visible'
  for (const layer of map.getStyle()?.layers ?? []) {
    if (isRoadLayer(layer.id)) map.setLayoutProperty(layer.id, 'visibility', ours)
    else if (isUpstreamRoadLayer(layer.id)) map.setLayoutProperty(layer.id, 'visibility', 'none')
  }
}

const STREET_NAMES = ['label_roads_minor', 'label_roads_major']

/** Street names white on a dark halo over imagery (the map's own colours over the map).
 * Called once the style is loaded: the map's colours are read from it. */
function streetNamesOverImagery(map: Map) {
  for (const id of STREET_NAMES) {
    if (!map.getLayer(id)) continue
    followBackground(map, id, 'text-color', {
      map: map.getPaintProperty(id, 'text-color'),
      imagery: NAME_COLOUR
    })
    followBackground(map, id, 'text-halo-color', {
      map: map.getPaintProperty(id, 'text-halo-color'),
      imagery: NAME_HALO_COLOUR
    })
    followBackground(map, id, 'text-halo-width', {
      map: map.getPaintProperty(id, 'text-halo-width'),
      imagery: NAME_HALO_WIDTH
    })
  }
}

const roads: ForkModule = {
  layers: () => ROADS.layers,

  init: ({ map }) => {
    for (const { layerId, property, values } of ROADS.following)
      followBackground(map, layerId, property, values as Parameters<typeof followBackground>[3])
    map.on('style.load', () => showRoads(map))
    background.onChange(() => showRoads(map))
    const loaded = () => {
      showRoads(map)
      streetNamesOverImagery(map)
    }
    if (map.isStyleLoaded()) loaded()
    else map.once('load', loaded)
  }
}

export default roads
