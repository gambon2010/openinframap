// Fork: the interiors' map layers (indoor.constants.ts has their look): the tint of
// what has a floor plan (buildings, and underground places dashed), then, for a floor
// chosen (floors.ts sets these layers' filters), a cover hiding the map under the
// building, its rooms, walls, paths and stairs, and room names. What stands inside
// isn't drawn: the building's details list it.
import type { ExpressionSpecification, FilterSpecification } from 'maplibre-gl'
import type { LayerSpecificationWithZIndex } from '../../../style/types.ts'
import { font, text_paint } from '../../../style/common.ts'
import * as look from './indoor.constants.ts'
import { NOTHING } from './floors.ts'

const OUTLINES = 'indoor_building'
const IS_UNDERGROUND: ExpressionSpecification = ['==', ['get', 'underground'], true]

export function indoorLayers(): LayerSpecificationWithZIndex[] {
  return [
    tint(look.TINT_LAYER, ['!', IS_UNDERGROUND]),
    tint(look.PLACE_LAYER, IS_UNDERGROUND),
    outline(look.TINT_OUTLINE_LAYER, ['!', IS_UNDERGROUND], undefined),
    outline(look.PLACE_OUTLINE_LAYER, IS_UNDERGROUND, look.PLACE_DASHES),
    cover(),
    areas(),
    areaOutlines(),
    lines(),
    labels()
  ]
}

function tint(id: string, filter: FilterSpecification): LayerSpecificationWithZIndex {
  return {
    zorder: look.TINT_ZORDER,
    id,
    type: 'fill',
    source: look.INDOOR_SOURCE,
    'source-layer': OUTLINES,
    minzoom: look.INDOOR_MIN_ZOOM,
    filter,
    paint: { 'fill-color': look.TINT_COLOUR, 'fill-opacity': look.TINT_OPACITY }
  }
}

function outline(
  id: string,
  filter: FilterSpecification,
  dashes: [number, number] | undefined
): LayerSpecificationWithZIndex {
  return {
    zorder: look.TINT_ZORDER + 0.001,
    id,
    type: 'line',
    source: look.INDOOR_SOURCE,
    'source-layer': OUTLINES,
    minzoom: look.INDOOR_MIN_ZOOM,
    filter,
    paint: {
      'line-color': look.TINT_COLOUR,
      'line-width': look.TINT_OUTLINE_WIDTH,
      ...(dashes ? { 'line-dasharray': dashes } : {})
    }
  }
}

/** The building under a floor shown, filled: the map under it hidden. */
function cover(): LayerSpecificationWithZIndex {
  return {
    zorder: look.FLOOR_ZORDER - 0.001,
    id: look.COVER_LAYER,
    type: 'fill',
    source: look.INDOOR_SOURCE,
    'source-layer': OUTLINES,
    filter: NOTHING,
    paint: { 'fill-color': look.COVER_COLOUR, 'fill-opacity': 1 }
  }
}

/** Rooms filled, corridors and open areas lighter, columns dark. */
function areas(): LayerSpecificationWithZIndex {
  return {
    zorder: look.FLOOR_ZORDER,
    id: look.AREA_LAYER,
    type: 'fill',
    source: look.INDOOR_SOURCE,
    'source-layer': 'indoor_area',
    filter: NOTHING,
    paint: {
      'fill-color': [
        'match',
        ['get', 'kind'],
        'room',
        look.ROOM_COLOUR,
        'column',
        look.WALL_COLOUR,
        look.OPEN_COLOUR
      ],
      'fill-opacity': 1
    }
  }
}

/** Each space's outline: its walls where none are drawn. */
function areaOutlines(): LayerSpecificationWithZIndex {
  return {
    zorder: look.FLOOR_ZORDER + 0.001,
    id: look.AREA_OUTLINE_LAYER,
    type: 'line',
    source: look.INDOOR_SOURCE,
    'source-layer': 'indoor_area',
    filter: NOTHING,
    paint: { 'line-color': look.WALL_COLOUR, 'line-width': 1 }
  }
}

/** Walls, paths, stairs and escalators; walls thicker. */
function lines(): LayerSpecificationWithZIndex {
  return {
    zorder: look.FLOOR_ZORDER + 0.002,
    id: look.LINE_LAYER,
    type: 'line',
    source: look.INDOOR_SOURCE,
    'source-layer': 'indoor_line',
    filter: NOTHING,
    paint: {
      'line-color': look.WALL_COLOUR,
      'line-width': ['match', ['get', 'kind'], 'wall', 2, 1]
    }
  }
}

/** Names, or references ("204"), of rooms and spaces. */
function labels(): LayerSpecificationWithZIndex {
  return {
    zorder: look.FLOOR_ZORDER + 0.004,
    id: look.LABEL_LAYER,
    type: 'symbol',
    source: look.INDOOR_SOURCE,
    'source-layer': 'indoor_area',
    filter: NOTHING,
    layout: {
      'text-field': ['coalesce', ['get', 'name'], ['get', 'ref'], ''],
      'text-font': font,
      'text-size': 11,
      'text-optional': true
    },
    paint: text_paint
  }
}
