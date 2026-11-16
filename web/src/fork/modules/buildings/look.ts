// Fork: how buildings are drawn (modules/buildings). Their outline, clickable
// inside (core/map-style.ts clickableArea); over imagery that inside is filled like
// a roof, with a small shadow, so buildings read as buildings even on blurry
// imagery. In the 3D view (services/view3d.ts) they're raised to their height
// instead: the flat roofs, shadows and outlines would lie on the ground under them.
import type {
  ExpressionSpecification,
  FillExtrusionLayerSpecification,
  FillLayerSpecification,
  FilterSpecification,
  LineLayerSpecification,
  Map
} from 'maplibre-gl'
import { clickableArea } from '../../core/map-style.ts'
import {
  BUILDINGS_LAYER,
  BUILDINGS_MINZOOM,
  BUILDINGS_SOURCE,
  BUILDINGS_SOURCE_LAYER,
  PARTS_LAYER,
  ZOOMED_OUT_LAYER,
  ZOOMED_OUT_MINZOOM,
  ZOOMED_OUT_SOURCE_LAYER
} from '../../core/buildings.ts'
import { background } from '../../services/background.ts'
import { view3d } from '../../services/view3d.ts'
import { LayerSpecificationWithZIndex } from '../../../style/types.ts'
import * as look from './buildings.constants.ts'

const OUTLINE_PAINT: LineLayerSpecification['paint'] = {
  'line-color': look.OUTLINE,
  'line-opacity': look.OUTLINE_OPACITY,
  'line-width': ['interpolate', ['linear'], ['zoom'], 12, 0.8, 15, 1, 18, 2, 20, 3]
}

interface Buildings {
  source: string
  sourceLayer: string
  filter?: FilterSpecification
  minzoom: number
  maxzoom?: number
}

const ZOOMED_OUT: Buildings = {
  source: BUILDINGS_SOURCE,
  sourceLayer: ZOOMED_OUT_SOURCE_LAYER,
  minzoom: ZOOMED_OUT_MINZOOM,
  maxzoom: BUILDINGS_MINZOOM
}
const WHOLE: Buildings = {
  source: BUILDINGS_SOURCE,
  sourceLayer: BUILDINGS_SOURCE_LAYER,
  filter: ['==', ['get', 'kind'], 'building'],
  minzoom: BUILDINGS_MINZOOM
}
const PARTS: Buildings = {
  source: BUILDINGS_SOURCE,
  sourceLayer: BUILDINGS_SOURCE_LAYER,
  filter: ['==', ['get', 'kind'], 'building_part'],
  minzoom: BUILDINGS_MINZOOM
}

function from(buildings: Buildings) {
  return {
    source: buildings.source,
    'source-layer': buildings.sourceLayer,
    ...(buildings.filter ? { filter: buildings.filter } : {}),
    minzoom: buildings.minzoom,
    ...(buildings.maxzoom === undefined ? {} : { maxzoom: buildings.maxzoom })
  }
}

/** A building's shadow over imagery (`<id>_shadow`): its shape in dark, shifted down
 * and right on screen, under the roof. */
function shadow(
  id: string,
  buildings: Buildings,
  zorder: number
): FillLayerSpecification & { zorder: number } {
  return {
    id: `${id}_shadow`,
    type: 'fill',
    zorder,
    ...from(buildings),
    paint: {
      'fill-color': look.SHADOW_COLOUR,
      'fill-opacity': 0,
      'fill-translate': look.SHADOW_OFFSET,
      'fill-translate-anchor': 'viewport'
    }
  }
}

/** Nothing: the raised buildings' filter outside the 3D view. Its visibility is the
 * layer switcher's (the Buildings entry), so it's hidden this way instead. */
const NOTHING: FilterSpecification = ['boolean', false]

/** Buildings raised to their height in the 3D view (`<id>_3d`), from the height they
 * start at (a part on top of another). */
function raised(
  id: string,
  buildings: Buildings,
  zorder: number
): FillExtrusionLayerSpecification & { zorder: number } {
  const height: ExpressionSpecification = ['coalesce', ['get', 'height'], look.DEFAULT_HEIGHT_M]
  return {
    id: `${id}_3d`,
    type: 'fill-extrusion',
    zorder,
    ...from(buildings),
    filter: NOTHING,
    paint: {
      'fill-extrusion-color': look.ROOF_COLOUR,
      'fill-extrusion-height': height,
      'fill-extrusion-base': ['coalesce', ['get', 'min_height'], 0],
      'fill-extrusion-opacity': look.RAISED_OPACITY
    }
  }
}

/** The layers filled like roofs over imagery, with a shadow, and raised in 3D: whole
 * buildings and the zoomed out ones. Parts lie inside buildings: a fill of their own
 * would darken them, and raised they'd sit in the building raised around them. */
const ROOFED: [string, Buildings][] = [
  [ZOOMED_OUT_LAYER, ZOOMED_OUT],
  [BUILDINGS_LAYER, WHOLE]
]
const OUTLINED = [ZOOMED_OUT_LAYER, PARTS_LAYER, BUILDINGS_LAYER]

/** Every buildings layer, bottom to top. */
export function buildingLayers(): LayerSpecificationWithZIndex[] {
  return [
    ...ROOFED.map(([id, buildings]) => shadow(id, buildings, -10.6)),
    // Zoomed out: those big enough to see at each zoom.
    ...clickableArea(ZOOMED_OUT_LAYER, ZOOMED_OUT, -10, OUTLINE_PAINT),
    // Parts under whole buildings: a click inside a building finds the building
    // first, whichever part it lands on. Parts with no building mapped around them
    // (about one in ten in Paris) are still clicked on their own.
    ...clickableArea(PARTS_LAYER, PARTS, -10.5, OUTLINE_PAINT),
    // Every whole building, under everything else that's data: the infrastructure
    // is drawn and clicked first.
    ...clickableArea(BUILDINGS_LAYER, WHOLE, -10, OUTLINE_PAINT),
    ...ROOFED.map(([id, buildings]) => raised(id, buildings, -9.9))
  ]
}

/** The look for the background and the 3D view, set now and after each change. */
export function followLook(map: Map) {
  const apply = () => applyLook(map)
  apply()
  map.on('style.load', apply)
  background.onChange(apply)
  view3d.onChange(apply)
}

function applyLook(map: Map) {
  const raisedNow = view3d.on()
  const flatRoofs = background.mode() !== 'map' && !raisedNow
  for (const [id, buildings] of ROOFED) {
    if (!map.getLayer(`${id}_hit`)) continue
    // The clickable inside, invisible over the map, is the roof.
    map.setPaintProperty(`${id}_hit`, 'fill-color', look.ROOF_COLOUR)
    map.setPaintProperty(`${id}_hit`, 'fill-opacity', flatRoofs ? look.ROOF_OPACITY : 0)
    map.setPaintProperty(`${id}_shadow`, 'fill-opacity', flatRoofs ? look.SHADOW_OPACITY : 0)
    map.setFilter(`${id}_3d`, raisedNow ? (buildings.filter ?? null) : NOTHING)
  }
  for (const id of OUTLINED)
    if (map.getLayer(id)) map.setPaintProperty(id, 'line-opacity', raisedNow ? 0 : look.OUTLINE_OPACITY)
}
