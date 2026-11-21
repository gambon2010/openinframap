// Fork: the contour lines' key rows: the section takes the Data layers entry's name,
// so it unfolds under it (ui/data-layers.ts), each part of the lines with its tick box
// hiding its layer (the parts not needed can go: supplementary lines, ticks, heights).
import { svg } from 'redom'
import { t } from '../../core/i18n.ts'
import type { KeyRow, KeySection } from '../../types.ts'
import { INDEX_LAYER, INTERMEDIATE_LAYER, LABEL_LAYER, SUPPLEMENTARY_LAYER, TICKS_LAYER } from './contours.ts'
import { CONTOUR_COLOUR, CONTOUR_LABEL_COLOUR } from './terrain.constants.ts'

const WIDTH = 30
const HEIGHT = 16

/** A contour's swatch: a brown line, thick or thin, dashed or not, ticked or not. */
function lineSwatch(width: number, dashes = '', ticks = false): SVGElement {
  const line = svg('line', {
    x1: 0,
    y1: 6,
    x2: WIDTH,
    y2: 6,
    stroke: CONTOUR_COLOUR.map,
    'stroke-width': width,
    'stroke-dasharray': dashes
  })
  const tickMarks = ticks
    ? [6, 15, 24].map((x) =>
        svg('line', { x1: x, y1: 6, x2: x, y2: 11, stroke: CONTOUR_COLOUR.map, 'stroke-width': 1.2 })
      )
    : []
  return svg('svg', { width: WIDTH, height: HEIGHT }, line, ...tickMarks)
}

/** The heights' swatch: a number in their brown. */
function heightSwatch(): SVGElement {
  return svg(
    'svg',
    { width: WIDTH, height: HEIGHT },
    svg('text', { x: 3, y: 12, 'font-size': 10, fill: CONTOUR_LABEL_COLOUR }, '500')
  )
}

export function contoursKey(entryName: string): KeySection {
  const row = (label: string, swatch: SVGElement, layer: string): KeyRow => [
    label,
    swatch,
    { layers: [layer] }
  ]
  return {
    title: entryName,
    rows: [
      row(t('contours.index', 'Index contours (every fifth)'), lineSwatch(1.8), INDEX_LAYER),
      row(t('contours.heights', 'Heights on index contours'), heightSwatch(), LABEL_LAYER),
      row(t('contours.intermediate', 'Intermediate contours'), lineSwatch(0.9), INTERMEDIATE_LAYER),
      row(
        t('contours.supplementary', 'Supplementary contours (level ground)'),
        lineSwatch(0.9, '4 3'),
        SUPPLEMENTARY_LAYER
      ),
      row(t('contours.depressions', 'Depression ticks (hollows)'), lineSwatch(0.9, '', true), TICKS_LAYER)
    ]
  }
}
