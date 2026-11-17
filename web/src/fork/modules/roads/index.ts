// Fork: the roads, railways, trams and metro (layers.ts), drawn by the fork over every
// background, the same at each zoom: entries of Data layers (Roads and railways),
// each unfolding to its kinds (key.ts). Over the map they're in a light look (white
// roads, grey edges) while their entry is unticked, bold once ticked; over imagery
// only the ticked ones show, bold. The background map's own roads are hidden: a
// second set, with other zooms; its own railways (trams) show instead of the fork's
// while Railways (Trams and metro) is unticked over the map. Borders over imagery (layers.ts). Street
// names turn white on a dark halo over imagery.
import type { ExpressionSpecification, FilterSpecification, Map } from 'maplibre-gl'
import { Layer, LayerGroup, type LayerSwitcher } from '@russss/maplibregl-layer-switcher'
import { t } from '../../core/i18n.ts'
import { background, followBackground } from '../../services/background.ts'
import { ForkModule } from '../../types.ts'
import { valueFor } from './builder.ts'
import { LANES_SOURCE, lanesSource } from './lane-layers.ts'
import { roadsKey } from './key.ts'
import { ROADS_PREFIX, roadLayers } from './layers.ts'
import { RAILWAYS_PREFIX, TRANSIT_KINDS, TRANSIT_PREFIX } from './rail-layers.ts'
import { NAME_COLOUR, NAME_HALO_COLOUR, NAME_HALO_WIDTH } from './roads.constants.ts'

const ROADS = roadLayers()

/** The Data layers entries (letters no entry has used: they're in map addresses),
 * by the prefix of the layers each switches. */
export const ROADS_SWITCHER_ID = 'J'
export const RAILWAYS_SWITCHER_ID = 'Y'
export const TRANSIT_SWITCHER_ID = 'X'
const ENTRIES: [prefix: string, entry: string][] = [
  [ROADS_PREFIX, ROADS_SWITCHER_ID],
  [RAILWAYS_PREFIX, RAILWAYS_SWITCHER_ID],
  [TRANSIT_PREFIX, TRANSIT_SWITCHER_ID]
]

/** The background map's own roads and railways (its piers stay: they're drawn as
 * ground). */
export function isMapRoadLayer(layerId: string): boolean {
  return /^osm_roads_(?!pier)|^osm_rail/.test(layerId)
}

/** Which of the background map's own railways show (a filter for its railway
 * layers), null for none: trains while Railways is unticked over the map, trams and
 * metro while Trams and metro is (its tiles mark trams from zoom 14). */
export function mapRailFilter(ticked: string[], overImagery: boolean): FilterSpecification | null {
  const trains = !ticked.includes(RAILWAYS_SWITCHER_ID)
  const trams = !ticked.includes(TRANSIT_SWITCHER_ID)
  if (overImagery || (!trains && !trams)) return null
  const isTram: ExpressionSpecification = ['in', ['get', 'kind_detail'], ['literal', TRANSIT_KINDS]]
  const isRail: ExpressionSpecification = ['==', ['get', 'kind'], 'rail']
  if (trains && trams) return isRail
  return ['all', isRail, trams ? isTram : ['!', isTram]]
}

const isMapRailLayer = (layerId: string) => layerId.startsWith('osm_rail')

/** A layer's entry (undefined: the borders, under upstream's Borders entry). */
export function entryOf(layerId: string): string | undefined {
  return ENTRIES.find(([prefix]) => layerId.startsWith(prefix))?.[1]
}

/** How a layer shows: bold once its entry is ticked (the borders always: they have
 * one look); else light over the map (railways, trams and metro hidden: the map's
 * own show, mapRailFilter), hidden over imagery. */
export function lookOf(entry: string | undefined, ticked: string[], overImagery: boolean) {
  if (entry === undefined || ticked.includes(entry)) return 'bold'
  if (overImagery || entry !== ROADS_SWITCHER_ID) return 'hidden'
  return 'light'
}

/** The layers in the order they're drawn: the light ones, then the bold ones over
 * them (each in their usual order: tunnels, roads, railways, trams). */
export function drawingOrder(looks: globalThis.Map<string, string>): string[] {
  const ids = [...looks.keys()]
  return [...ids.filter((id) => looks.get(id) !== 'bold'), ...ids.filter((id) => looks.get(id) === 'bold')]
}

/** The layers moved into their drawing order, before the style's next layer. */
function reorder(map: Map, order: string[]) {
  const style = (map.getStyle()?.layers ?? []).map((l) => l.id)
  const last = Math.max(...order.map((id) => style.indexOf(id)))
  const next = style[last + 1]
  for (const id of order) if (map.getLayer(id)) map.moveLayer(id, next)
}

/** Calls `changed` after each change of the switcher's entries (a tick, the map's
 * address, the start): when the layers' visibility doesn't change (light already
 * shown), the map doesn't say so. */
function onEntriesChange(switcher: LayerSwitcher, changed: () => void) {
  const update = switcher._updateVisibility.bind(switcher)
  switcher._updateVisibility = () => {
    update()
    changed()
  }
}

/** Each layer in its look for its entry and the background, the bold over the
 * light. Checked after each entry change and style change, changing only what
 * differs (each change is a style change). */
function followEntries(map: Map, switcher: LayerSwitcher) {
  let ordered = ''
  const sync = () => {
    const overImagery = background.mode() !== 'map'
    const looks = new globalThis.Map(
      ROADS.layers.map((layer) => [layer.id, lookOf(entryOf(layer.id), switcher._visible, overImagery)])
    )
    const order = drawingOrder(looks)
    if (order.join() !== ordered) {
      ordered = order.join()
      reorder(map, order)
    }
    for (const [layerId, look] of looks) {
      if (!map.getLayer(layerId) || entryOf(layerId) === undefined) continue
      const visibility = look === 'hidden' ? 'none' : 'visible'
      if (map.getLayoutProperty(layerId, 'visibility') !== visibility)
        map.setLayoutProperty(layerId, 'visibility', visibility)
    }
    for (const { layerId, property, values } of ROADS.varying) {
      if (!map.getLayer(layerId)) continue
      const value = valueFor(values, looks.get(layerId) === 'bold', overImagery)
      if (JSON.stringify(map.getPaintProperty(layerId, property)) !== JSON.stringify(value))
        map.setPaintProperty(layerId, property, value as never)
    }
    const railFilter = mapRailFilter(switcher._visible, overImagery)
    for (const layer of map.getStyle()?.layers ?? []) {
      if (!isMapRoadLayer(layer.id)) continue
      const shown = isMapRailLayer(layer.id) && railFilter !== null
      const visibility = shown ? 'visible' : 'none'
      if (map.getLayoutProperty(layer.id, 'visibility') !== visibility)
        map.setLayoutProperty(layer.id, 'visibility', visibility)
      if (shown && JSON.stringify(map.getFilter(layer.id)) !== JSON.stringify(railFilter))
        map.setFilter(layer.id, railFilter)
    }
  }
  map.on('styledata', sync)
  // A new style has the layers in their first order.
  map.on('style.load', () => {
    ordered = ''
    sync()
  })
  background.onChange(sync)
  onEntriesChange(switcher, sync)
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

/** The entries' names: their key sections are named alike, to unfold under them. */
const entryNames = () => ({
  roads: t('layers.roads', 'Roads'),
  railways: t('layers.railways', 'Railways'),
  transit: t('layers.trams-and-metro', 'Trams and metro')
})

const roads: ForkModule = {
  sources: () => ({ [LANES_SOURCE]: lanesSource() }),

  layers: () => ROADS.layers,

  switcherGroups: () => {
    const names = entryNames()
    return [
      new LayerGroup(t('layers.roads-and-railways', 'Roads and railways'), [
        new Layer(ROADS_SWITCHER_ID, names.roads, ROADS_PREFIX, false),
        new Layer(RAILWAYS_SWITCHER_ID, names.railways, RAILWAYS_PREFIX, false),
        new Layer(TRANSIT_SWITCHER_ID, names.transit, TRANSIT_PREFIX, false)
      ])
    ]
  },

  key: async () => roadsKey(entryNames()),

  init: ({ map, layerSwitcher }) => {
    const loaded = () => {
      followEntries(map, layerSwitcher)
      streetNamesOverImagery(map)
    }
    if (map.isStyleLoaded()) loaded()
    else map.once('load', loaded)
  }
}

export default roads
