// Fork: the contour lines' map layers, as on US military maps (docs/STYLE.md,
// "Contour lines"): thin intermediate contours, heavier index contours (every fifth)
// with their height written along them, dashed supplementary contours on level
// ground, and ticks on depressions' downhill side. The lines, their kinds and the
// interval are the backend's (web-backend/src/fork/terrain/contours.py).
import type { ExpressionSpecification, LineLayerSpecification, SymbolLayerSpecification } from 'maplibre-gl'
import { font } from '../../../style/common.ts'
import {
  CONTOURS_PREFIX,
  CONTOURS_SOURCE,
  CONTOURS_SOURCE_LAYER,
  CONTOUR_COLOUR,
  CONTOUR_LABEL_COLOUR,
  CONTOUR_LABEL_HALO,
  INDEX_WIDTH,
  INTERMEDIATE_WIDTH,
  SUPPLEMENTARY_DASHES,
  TICK_DASHES,
  TICK_LENGTH
} from './terrain.constants.ts'

export const SUPPLEMENTARY_LAYER = `${CONTOURS_PREFIX}_supplementary`
export const INTERMEDIATE_LAYER = `${CONTOURS_PREFIX}_intermediate`
export const INDEX_LAYER = `${CONTOURS_PREFIX}_index`
export const TICKS_LAYER = `${CONTOURS_PREFIX}_ticks`
export const LABEL_LAYER = `${CONTOURS_PREFIX}_label`
/** In the order they're drawn. */
export const CONTOUR_LAYERS = [SUPPLEMENTARY_LAYER, INTERMEDIATE_LAYER, INDEX_LAYER, TICKS_LAYER, LABEL_LAYER]
/** The layers drawn in the lines' colour (the labels have their own). */
export const CONTOUR_LINE_LAYERS = [SUPPLEMENTARY_LAYER, INTERMEDIATE_LAYER, INDEX_LAYER, TICKS_LAYER]

type Kind = 'index' | 'intermediate' | 'supplementary'

const ofKind = (kind: Kind): ExpressionSpecification => ['==', ['get', 'kind'], kind]
const isDepression: ExpressionSpecification = ['==', ['get', 'depression'], true]

/** A width growing from zoom 9 to 16. */
function width([at9, at16]: [number, number]): ExpressionSpecification {
  return ['interpolate', ['linear'], ['zoom'], 9, at9, 16, at16]
}

function line(id: string, kind: Kind, widths: [number, number], dashes?: number[]): LineLayerSpecification {
  return {
    id,
    type: 'line',
    source: CONTOURS_SOURCE,
    'source-layer': CONTOURS_SOURCE_LAYER,
    filter: ofKind(kind),
    layout: { 'line-join': 'round', 'line-cap': dashes ? 'butt' : 'round' },
    paint: {
      'line-color': CONTOUR_COLOUR.map,
      'line-width': width(widths),
      ...(dashes ? { 'line-dasharray': dashes } : {})
    }
  }
}

/** Short ticks on a depression's downhill side (its right, as the backend orders
 * it): a wide dashed line pushed half its width off the contour. */
const ticks: LineLayerSpecification = {
  id: TICKS_LAYER,
  type: 'line',
  source: CONTOURS_SOURCE,
  'source-layer': CONTOURS_SOURCE_LAYER,
  filter: isDepression,
  layout: { 'line-cap': 'butt', 'line-join': 'round' },
  paint: {
    'line-color': CONTOUR_COLOUR.map,
    'line-width': TICK_LENGTH,
    'line-offset': TICK_LENGTH / 2,
    'line-dasharray': TICK_DASHES
  }
}

/** The index contours' heights, along them. */
const label: SymbolLayerSpecification = {
  id: LABEL_LAYER,
  type: 'symbol',
  source: CONTOURS_SOURCE,
  'source-layer': CONTOURS_SOURCE_LAYER,
  filter: ofKind('index'),
  layout: {
    'symbol-placement': 'line',
    'symbol-spacing': 300,
    'text-field': ['to-string', ['get', 'ele']],
    'text-font': font,
    'text-size': 10,
    'text-max-angle': 25,
    'text-padding': 4
  },
  paint: {
    'text-color': CONTOUR_LABEL_COLOUR.map,
    'text-halo-color': CONTOUR_LABEL_HALO.map,
    'text-halo-width': 1.2
  }
}

export function contourLayers(): (LineLayerSpecification | SymbolLayerSpecification)[] {
  return [
    line(SUPPLEMENTARY_LAYER, 'supplementary', INTERMEDIATE_WIDTH, SUPPLEMENTARY_DASHES),
    line(INTERMEDIATE_LAYER, 'intermediate', INTERMEDIATE_WIDTH),
    line(INDEX_LAYER, 'index', INDEX_WIDTH),
    ticks,
    label
  ]
}
