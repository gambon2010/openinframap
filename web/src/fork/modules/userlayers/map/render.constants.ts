// Fork: My layers' map drawing (render.ts): the ids of its overlays, the selection's
// colours, the filters its layers share, and the sizes an image can have.
import { FilterSpecification, SymbolLayerSpecification } from 'maplibre-gl'
import { font } from '../../../../style/common.ts'
import { KINDS } from '../kinds/index.ts'

export const SELECTION = 'user_selection'

// The selection's yellow, and its handles' darker yellow (points, sizes, widths).
export const HIGHLIGHT = '#ffd600'

export const HANDLE = '#b88a00'

export const DRAFT = 'user_draft'

// What a placing tool would put down, faint under the cursor ("user_draft…": kept
// with the draft when the map's layers are tidied).
export const GHOST = 'user_draft_ghost'

// A graphic being drawn, as it will look (faint).
export const GRAPHIC_DRAFT = 'user_draft_graphic'

export const POLYGON: FilterSpecification = [
  'in',
  ['geometry-type'],
  ['literal', ['Polygon', 'MultiPolygon']]
]

export const LINE_OR_POLYGON: FilterSpecification = [
  'in',
  ['geometry-type'],
  ['literal', ['LineString', 'MultiLineString', 'Polygon', 'MultiPolygon']]
]

export const POINT: FilterSpecification = ['in', ['geometry-type'], ['literal', ['Point', 'MultiPoint']]]

// Kinds drawn the standard way (kinds/): copies are drawn by clones of upstream's
// layers, graphics from their own source.
export const OWN: FilterSpecification = [
  '!',
  ['in', ['get', 'kind'], ['literal', KINDS.filter((k) => k.drawn !== 'standard').map((k) => k.id)]]
]

/** Measurement labels: turned and placed as each says (measure/features.ts); where
 * two would overlap, the one with the lower priority stays (the total first). */
export const MEASURE_LABEL_LAYOUT: SymbolLayerSpecification['layout'] = {
  'text-field': ['coalesce', ['get', 'label'], ['get', 'tickLabel']],
  'text-font': font,
  'text-size': ['case', ['has', 'tickLabel'], 10, ['==', ['get', 'big'], true], 14, 12],
  'text-rotate': ['coalesce', ['get', 'rotate'], 0],
  'text-rotation-alignment': 'map',
  'text-offset': ['coalesce', ['array', 'number', 2, ['get', 'offset']], ['literal', [0, 0]]],
  'text-anchor': ['coalesce', ['get', 'anchor'], 'center'],
  'symbol-sort-key': ['coalesce', ['get', 'priority'], 1],
  'text-allow-overlap': false,
  'text-padding': 1,
  // One line along the leg ("23.7 km · 005°T (89 mils)").
  'text-max-width': 40
}

// Sizes a picture, symbol or marker can have (1 = its normal size).
export const MIN_SIZE = 0.2

export const MAX_SIZE = 8

/** The selection's box around a picture, symbol or marker: this far out (px). */
export const OUTLINE_PAD_PX = 4
