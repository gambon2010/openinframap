// Fork: a clicked tram or metro line highlighted along its whole length (modules/roads).
// LOOM's lanes are tiles with each line's lanes offset beside the others, so the
// highlight is two layers on those tiles, filtered to the line: a glow over the
// lanes and the line's own lane over it, at every zoom the lanes show and wherever
// the map goes; and its stops (the tiles' STOPS_LAYER: the backend's line_stops.py),
// each named. Cleared with the details panel's highlight
// (ui/highlight.ts).
import type { ExpressionSpecification, FilterSpecification, Map, MapGeoJSONFeature } from 'maplibre-gl'
import { font } from '../../../style/common.ts'
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
/** The tiles' layer of stops: each with its name and the lines calling there
 * (",A,D,"; line_stops.py's). */
export const STOPS_LAYER = 'stops'
const STOPS_ID = 'lane_highlight_stops'
const STOP_NAMES_ID = 'lane_highlight_stop_names'
/** A stop's name: smaller zoomed out, where the stops are close together. */
const STOP_NAME_SIZE: ExpressionSpecification = ['interpolate', ['linear'], ['zoom'], LANES_FROM, 11, 15, 13]
/** Ems between a dot and its name. */
const STOP_NAME_GAP = 0.9
const STOP_NAME_HALO = 1.5
const STOP_RADIUS: ExpressionSpecification = ['interpolate', ['linear'], ['zoom'], LANES_FROM, 3, 18, 7]
const STOP_EDGE_COLOUR = '#222222'
const STOP_FILL = '#ffffff'

/** The highlight's layers: per LOOM layer, a glow then the lane. */
function highlightIds(sourceLayer: string) {
  return { glow: `lane_highlight_${sourceLayer}_glow`, lane: `lane_highlight_${sourceLayer}` }
}

/** A line's lanes and joins: its kind and letter ("tram", "A"). */
export function lineFilter(kind: string, ref: string): FilterSpecification {
  return ['all', ['==', ['get', 'kind'], kind], ['==', ['get', 'ref'], ref]]
}

/** The stops a line calls at, by its letter (a stop's lines: ",A,D,"). */
export function stopsFilter(ref: string): FilterSpecification {
  return ['in', `,${ref},`, ['get', 'lines']]
}

/** A highlighted line's stops, a dot each over its lane, each named: the
 * names on top of everything, so the map's own labels don't push them out (the
 * higher a label's layer, the sooner it gets its place), on whichever side of the
 * dot has room. */
function addStopLayers(map: Map, before: string | undefined) {
  if (map.getLayer(STOPS_ID)) return
  const from = { source: LANES_SOURCE, 'source-layer': STOPS_LAYER, minzoom: LANES_FROM, filter: NOTHING }
  map.addLayer(
    {
      ...from,
      id: STOPS_ID,
      type: 'circle',
      paint: {
        'circle-radius': STOP_RADIUS,
        'circle-color': STOP_FILL,
        'circle-stroke-color': STOP_EDGE_COLOUR,
        'circle-stroke-width': 1.5
      }
    },
    before
  )
  map.addLayer({
    ...from,
    id: STOP_NAMES_ID,
    type: 'symbol',
    layout: {
      'text-field': ['get', 'name'],
      'text-font': font,
      'text-size': STOP_NAME_SIZE,
      'text-variable-anchor': ['left', 'right', 'top', 'bottom'],
      'text-radial-offset': STOP_NAME_GAP
    },
    // A thin halo: the map's labels' wide blurred one is a white box around a name.
    paint: {
      'text-color': STOP_EDGE_COLOUR,
      'text-halo-color': STOP_FILL,
      'text-halo-width': STOP_NAME_HALO
    }
  })
}

/** The layer just above every roads layer (the borders are the last: layers.ts),
 * undefined if none. Not among them: the roads module keeps its layers in order by
 * moving them (index.ts reorder), over anything in between. */
function aboveRoads(map: Map): string | undefined {
  const ids = (map.getStyle()?.layers ?? []).map((layer) => layer.id)
  const last = ids.indexOf(`${BORDERS_PREFIX}countries`)
  return last < 0 ? undefined : ids[last + 1]
}

/** The highlight's layers over every lane and border, matching nothing yet. */
function addLayers(map: Map) {
  const before = aboveRoads(map)
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
  addStopLayers(map, before)
}

/** Only these lanes and stops highlighted. */
function showOnly(map: Map, lanes: FilterSpecification, stops: FilterSpecification) {
  for (const sourceLayer of LOOM_LAYERS) {
    const ids = highlightIds(sourceLayer)
    for (const id of [ids.glow, ids.lane]) if (map.getLayer(id)) map.setFilter(id, lanes)
  }
  for (const id of [STOPS_ID, STOP_NAMES_ID]) if (map.getLayer(id)) map.setFilter(id, stops)
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
  highlight.onClear(() => showOnly(map, NOTHING, NOTHING))
  addDetailsExtra((feature) => {
    if (!isLane(feature)) return
    // The details' own highlight drew the clicked piece only: the whole line instead.
    highlight.setData([])
    const ref = String(feature.properties['ref'])
    showOnly(map, lineFilter(String(feature.properties['kind']), ref), stopsFilter(ref))
  })
}
