// Fork: the interiors' map layers (indoor.constants.ts has their look): the tint of
// buildings with an interior, then a floor's rooms, walls, paths and stairs, what
// stands inside, and names. The floor layers draw nothing until a floor is chosen
// (floors.ts sets their filter).
import type { LayerSpecificationWithZIndex } from '../../../style/types.ts'
import { font, text_paint } from '../../../style/common.ts'
import * as look from './indoor.constants.ts'
import { NOTHING } from './floors.ts'

export function indoorLayers(): LayerSpecificationWithZIndex[] {
  return [tint(), areas(), areaOutlines(), lines(), points(), labels()]
}

function tint(): LayerSpecificationWithZIndex {
  return {
    zorder: look.TINT_ZORDER,
    id: look.TINT_LAYER,
    type: 'fill',
    source: look.INDOOR_SOURCE,
    'source-layer': 'indoor_building',
    minzoom: look.INDOOR_MIN_ZOOM,
    paint: { 'fill-color': look.TINT_COLOUR, 'fill-opacity': look.TINT_OPACITY }
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
      'fill-opacity': 0.95
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

/** Walls solid, paths dashed, stairs and escalators in steps. */
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
      'line-width': ['match', ['get', 'kind'], 'wall', 2, 1.5],
      'line-dasharray': ['match', ['get', 'kind'], 'path', ['literal', [2, 2]], ['literal', [1, 0]]]
    }
  }
}

/** Doors white with a dark ring, lifts and stairs dark, the rest small dots. */
function points(): LayerSpecificationWithZIndex {
  return {
    zorder: look.FLOOR_ZORDER + 0.003,
    id: look.POINT_LAYER,
    type: 'circle',
    source: look.INDOOR_SOURCE,
    'source-layer': 'indoor_point',
    filter: NOTHING,
    paint: {
      'circle-radius': ['match', ['get', 'kind'], 'door', 3, 'elevator', 4, 'stairs', 4, 3],
      'circle-color': ['match', ['get', 'kind'], 'door', '#fff', look.POINT_COLOUR],
      'circle-stroke-color': look.WALL_COLOUR,
      'circle-stroke-width': ['match', ['get', 'kind'], 'door', 1.5, 0]
    }
  }
}

/** Names, or references ("204"), of rooms and what's inside. */
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
