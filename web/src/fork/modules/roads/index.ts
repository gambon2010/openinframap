// Fork: bold roads, railways and trams (layers.ts), entries of Data layers (Roads
// and railways), off at first. Over the map, the map's own light roads and railways
// show (its zooms); a ticked entry's bold lines replace the light ones of its kind,
// the same at each zoom over the map and over imagery. Over imagery, only the
// ticked ones show (the map is under the imagery), and the borders (layers.ts).
// Street names turn white on a dark halo over imagery.
import type { ExpressionSpecification, Map } from 'maplibre-gl'
import { Layer, LayerGroup } from '@russss/maplibregl-layer-switcher'
import { t } from '../../core/i18n.ts'
import { followBackground } from '../../services/background.ts'
import { ForkModule } from '../../types.ts'
import { RAILWAYS_PREFIX, ROADS_PREFIX, TRAMS_PREFIX, roadLayers } from './layers.ts'
import { NAME_COLOUR, NAME_HALO_COLOUR, NAME_HALO_WIDTH } from './roads.constants.ts'

const ROADS = roadLayers()

/** The Data layers entries (letters no entry has used: they're in map addresses). */
export const ROADS_SWITCHER_ID = 'J'
export const RAILWAYS_SWITCHER_ID = 'Y'
export const TRAMS_SWITCHER_ID = 'X'

/** The map's own roads (its piers stay: they're drawn as ground). */
export const isMapRoadLayer = (layerId: string) => /^osm_roads_(?!pier)/.test(layerId)
/** The map's own railways and trams, one kind (`rail`) told apart by kind_detail. */
export const isMapRailLayer = (layerId: string) => layerId.startsWith('osm_rail')

const isTram: ExpressionSpecification = ['==', ['get', 'kind_detail'], 'tram']

/** Which of the map's rail lines show: those whose bold ones aren't ticked. */
export function mapRailFilter(railways: boolean, trams: boolean): ExpressionSpecification {
  const kept: ExpressionSpecification[] = [['==', ['get', 'kind'], 'rail']]
  if (railways) kept.push(isTram)
  if (trams) kept.push(['!', isTram])
  return ['all', ...kept]
}

/** Whether an entry's bold lines are switched on (their first layer shown). */
function ticked(map: Map, prefix: string): boolean {
  const first = ROADS.layers.find((l) => l.id.startsWith(prefix))
  return !!first && !!map.getLayer(first.id) && map.getLayoutProperty(first.id, 'visibility') !== 'none'
}

/** The map's light roads and railways hidden where the bold ones are ticked. The
 * layer switcher says nothing when an entry changes: checked at each style change,
 * changing only what differs (each change is a style change). */
function followTicks(map: Map) {
  let applied = ''
  const sync = () => {
    const roads = ticked(map, ROADS_PREFIX)
    const railFilter = mapRailFilter(ticked(map, RAILWAYS_PREFIX), ticked(map, TRAMS_PREFIX))
    const state = JSON.stringify([roads, railFilter])
    if (state === applied) return
    applied = state
    for (const layer of map.getStyle()?.layers ?? []) {
      if (isMapRoadLayer(layer.id)) map.setLayoutProperty(layer.id, 'visibility', roads ? 'none' : 'visible')
      else if (isMapRailLayer(layer.id)) map.setFilter(layer.id, railFilter)
    }
  }
  map.on('styledata', sync)
  // A new style has the map's own layers as they were.
  map.on('style.load', () => {
    applied = ''
    sync()
  })
  sync()
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

  switcherGroups: () => [
    new LayerGroup(t('layers.roads-and-railways', 'Roads and railways'), [
      new Layer(ROADS_SWITCHER_ID, t('layers.roads', 'Roads'), ROADS_PREFIX, false),
      new Layer(RAILWAYS_SWITCHER_ID, t('layers.railways', 'Railways'), RAILWAYS_PREFIX, false),
      new Layer(TRAMS_SWITCHER_ID, t('layers.trams', 'Trams'), TRAMS_PREFIX, false)
    ])
  ],

  init: ({ map }) => {
    for (const { layerId, property, values } of ROADS.following)
      followBackground(map, layerId, property, values)
    const loaded = () => {
      followTicks(map)
      streetNamesOverImagery(map)
    }
    if (map.isStyleLoaded()) loaded()
    else map.once('load', loaded)
  }
}

export default roads
