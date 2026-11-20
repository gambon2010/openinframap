// Fork: the contour lines' map layers, as on US military maps (docs/STYLE.md,
// "Contour lines"): thin intermediate contours, heavier index contours (every fifth)
// with their height written along them. The lines and the interval are the
// backend's (web-backend/src/fork/terrain/contours.py).
import type { ExpressionSpecification, LineLayerSpecification, SymbolLayerSpecification } from 'maplibre-gl'
import { font } from '../../../style/common.ts'
import {
  CONTOURS_PREFIX,
  CONTOURS_SOURCE,
  CONTOURS_SOURCE_LAYER,
  CONTOUR_COLOUR,
  INDEX_WIDTH,
  INTERMEDIATE_WIDTH
} from './terrain.constants.ts'

export const INTERMEDIATE_LAYER = `${CONTOURS_PREFIX}_intermediate`
export const INDEX_LAYER = `${CONTOURS_PREFIX}_index`
export const LABEL_LAYER = `${CONTOURS_PREFIX}_label`
/** In the order they're drawn. */
export const CONTOUR_LAYERS = [INTERMEDIATE_LAYER, INDEX_LAYER, LABEL_LAYER]

const isIndex: ExpressionSpecification = ['==', ['get', 'index'], true]

/** A width growing from zoom 9 to 16. */
function width([at9, at16]: [number, number]): ExpressionSpecification {
  return ['interpolate', ['linear'], ['zoom'], 9, at9, 16, at16]
}

function line(id: string, index: boolean, widths: [number, number]): LineLayerSpecification {
  return {
    id,
    type: 'line',
    source: CONTOURS_SOURCE,
    'source-layer': CONTOURS_SOURCE_LAYER,
    filter: index ? isIndex : ['!', isIndex],
    layout: { 'line-join': 'round', 'line-cap': 'round' },
    paint: { 'line-color': CONTOUR_COLOUR.map, 'line-width': width(widths) }
  }
}

/** The index contours' heights, along them. */
const label: SymbolLayerSpecification = {
  id: LABEL_LAYER,
  type: 'symbol',
  source: CONTOURS_SOURCE,
  'source-layer': CONTOURS_SOURCE_LAYER,
  filter: isIndex,
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
    'text-color': CONTOUR_COLOUR.map,
    'text-halo-color': 'rgba(255, 255, 255, 0.85)',
    'text-halo-width': 1.2
  }
}

export function contourLayers(): (LineLayerSpecification | SymbolLayerSpecification)[] {
  return [line(INTERMEDIATE_LAYER, false, INTERMEDIATE_WIDTH), line(INDEX_LAYER, true, INDEX_WIDTH), label]
}
