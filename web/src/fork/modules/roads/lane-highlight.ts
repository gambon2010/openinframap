// Fork: a clicked tram or metro line highlighted along its whole length (modules/roads).
// LOOM's lanes are tiles with each line's lanes offset beside the others, so the
// highlight is two layers on those tiles, filtered to the line: a glow over the
// lanes and the line's own lane over it, at every zoom the lanes show and wherever
// the map goes. Cleared with the details panel's highlight (ui/highlight.ts).
import type { FilterSpecification, Map, MapGeoJSONFeature } from 'maplibre-gl'
import { addDetailsExtra } from '../../ui/details.ts'
import { leftColumn } from '../../ui/left-column.ts'
import { LANES_FROM } from './roads.constants.ts'
import { LANES_SOURCE, LOOM_LAYERS, laneWidth } from './lane-layers.ts'
import { BORDERS_PREFIX } from './layers.ts'

const GLOW_COLOUR = '#ffd400' // the details' highlight's (ui/highlight.ts)
const GLOW_OPACITY = 0.8
const GLOW_BLUR = 2
/** Pixels of glow either side of the lane. */
const GLOW_REACH = 5
const NOTHING: FilterSpecification = ['==', ['get', 'ref'], '']

/** The highlight's layers: per LOOM layer, a glow then the lane. */
function highlightIds(sourceLayer: string) {
  return { glow: `lane_highlight_${sourceLayer}_glow`, lane: `lane_highlight_${sourceLayer}` }
}

/** A line's lanes and joins: its kind and letter ("tram", "A"). */
export function lineFilter(kind: string, ref: string): FilterSpecification {
  return ['all', ['==', ['get', 'kind'], kind], ['==', ['get', 'ref'], ref]]
}

/** The highlight's layers over the lanes, under the borders, matching nothing yet. */
function addLayers(map: Map) {
  const before = map.getLayer(`${BORDERS_PREFIX}countries_edge`)
    ? `${BORDERS_PREFIX}countries_edge`
    : undefined
  const glowWidth = laneWidth(2 * GLOW_REACH)
  for (const sourceLayer of LOOM_LAYERS) {
    const ids = highlightIds(sourceLayer)
    if (map.getLayer(ids.glow)) continue
    const from = { source: LANES_SOURCE, 'source-layer': sourceLayer, minzoom: LANES_FROM, filter: NOTHING }
    const layout = { 'line-cap': 'round', 'line-join': 'round' } as const
    map.addLayer(
      {
        ...from,
        id: ids.glow,
        type: 'line',
        layout,
        paint: {
          'line-color': GLOW_COLOUR,
          'line-width': glowWidth,
          'line-blur': GLOW_BLUR,
          'line-opacity': GLOW_OPACITY
        }
      },
      before
    )
    map.addLayer(
      {
        ...from,
        id: ids.lane,
        type: 'line',
        layout,
        paint: { 'line-color': ['to-color', ['get', 'colour'], GLOW_COLOUR], 'line-width': laneWidth() }
      },
      before
    )
  }
}

function showOnly(map: Map, filter: FilterSpecification) {
  for (const sourceLayer of LOOM_LAYERS) {
    const ids = highlightIds(sourceLayer)
    for (const id of [ids.glow, ids.lane]) if (map.getLayer(id)) map.setFilter(id, filter)
  }
}

function isLane(feature: MapGeoJSONFeature) {
  return feature.source === LANES_SOURCE && Boolean(feature.properties['ref'])
}

/** A clicked line highlighted whole, until the details close or something else is picked. */
export function highlightWholeLines(map: Map) {
  map.on('style.load', () => addLayers(map))
  if (map.isStyleLoaded()) addLayers(map)
  else map.once('load', () => addLayers(map))
  const highlight = leftColumn.highlight
  highlight.onClear(() => showOnly(map, NOTHING))
  addDetailsExtra((feature) => {
    if (!isLane(feature)) return
    // The details' own highlight drew the clicked piece only: the whole line instead.
    highlight.setData([])
    showOnly(map, lineFilter(String(feature.properties['kind']), String(feature.properties['ref'])))
  })
}
