// Fork: a layer's symbols drawn to scale (its menu: "Symbols to scale"), instead of the
// same size on screen at every zoom: from the zoom it was switched on at (the layer's
// `style.scaledAt`), each zoom level out halves them and each in doubles them, as a
// real object on the map. Zoomed in they stop growing at MOST_GROWTH; zoomed out past
// a quarter of their size they become small dots of their identity's colour, so they
// don't vanish. Markers and pictures alike. Pure: layers.ts and render.ts use it.
import type { ExpressionSpecification } from 'maplibre-gl'
import { identity } from '../model/sidc.ts'
import type { FeatureProps } from '../model/model.ts'
import { DEFAULT_COLOR } from '../model/model.ts'
import { DOT_BELOW, IDENTITY_FILLS, MOST_GROWTH } from './scale.constants.ts'

/** How much bigger a symbol is drawn at a zoom than as its size says (1: not scaled). */
export function zoomFactor(scaledAt: number | undefined, zoom: number): number {
  if (scaledAt === undefined) return 1
  return Math.min(MOST_GROWTH, 2 ** (zoom - scaledAt))
}

/** Below this zoom a scaled layer's symbols are dots. */
export function dotZoom(scaledAt: number): number {
  return scaledAt - Math.log2(1 / DOT_BELOW)
}

/** The map's size for a scaled layer's symbols: their size, times 2 per zoom level
 * from where it was switched on (MapLibre interpolates a power of 2 between the stops
 * exactly), up to MOST_GROWTH. */
export function scaledIconSize(scaledAt: number): ExpressionSpecification {
  const size: ExpressionSpecification = ['coalesce', ['get', 'size'], 1]
  const grownAt = scaledAt + Math.log2(MOST_GROWTH)
  return [
    'interpolate',
    ['exponential', 2],
    ['zoom'],
    dotZoom(scaledAt),
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
