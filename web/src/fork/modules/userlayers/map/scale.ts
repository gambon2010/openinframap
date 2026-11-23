// Fork: a layer's symbols drawn to scale (its menu: "Symbol scale…"), instead of the
// same size on screen at every zoom: as their size says at the map scale chosen (the
// layer's `style.symbolScale`, one of SCALE_STEPS; drawn at the zoom that scale is at
// the map's latitude, its "symbol zoom"), each zoom level out halves them and each in
// doubles them, as a real object on the map. Zoomed in they stop growing at MOST_GROWTH; zoomed out past
// a quarter of their size they become small dots of their identity's colour, so they
// don't vanish. Markers and pictures alike. Pure: layers.ts and render.ts use it.
import type { ExpressionSpecification } from 'maplibre-gl'
import { identity } from '../model/sidc.ts'
import type { FeatureProps } from '../model/model.ts'
import { DEFAULT_COLOR } from '../model/model.ts'
import { DOT_BELOW, IDENTITY_FILLS, MOST_GROWTH, SCALE_STEPS } from './scale.constants.ts'

/** The scale step nearest a map scale (1:n), by ratio: what the slider starts on. */
export function nearestStep(scale: number): number {
  const distance = (step: number) => Math.abs(Math.log(step / scale))
  return SCALE_STEPS.reduce((best, step) => (distance(step) < distance(best) ? step : best))
}

/** "1:25 000": a scale as maps write it (thousands apart). */
export function scaleLabel(scale: number): string {
  return `1:${String(scale).replace(/\B(?=(\d{3})+(?!\d))/g, ' ')}`
}

/** How much bigger a symbol is drawn at a zoom than as its size says (1: not scaled). */
export function zoomFactor(symbolZoom: number | undefined, zoom: number): number {
  if (symbolZoom === undefined) return 1
  return Math.min(MOST_GROWTH, 2 ** (zoom - symbolZoom))
}

/** Below this zoom a layer to scale has its symbols as dots. */
export function dotZoom(symbolZoom: number): number {
  return symbolZoom - Math.log2(1 / DOT_BELOW)
}

/** The map's size for a scaled layer's symbols: their size, times 2 per zoom level
 * from where it was switched on (MapLibre interpolates a power of 2 between the stops
 * exactly), up to MOST_GROWTH. */
export function scaledIconSize(symbolZoom: number): ExpressionSpecification {
  const size: ExpressionSpecification = ['coalesce', ['get', 'size'], 1]
  const grownAt = symbolZoom + Math.log2(MOST_GROWTH)
  return [
    'interpolate',
    ['exponential', 2],
    ['zoom'],
    dotZoom(symbolZoom),
    ['*', size, DOT_BELOW],
    grownAt,
    ['*', size, MOST_GROWTH]
  ]
}

/** A symbol's dot when it's too small to see: its identity's fill (MIL-STD-2525C's),
 * else the item's own colour (a marker, a picture's frame). */
export function dotColour(p: FeatureProps): string {
  if (p.sidc) return IDENTITY_FILLS[identity(p.sidc)] ?? IDENTITY_FILLS.U
  return p.color ?? DEFAULT_COLOR
}
