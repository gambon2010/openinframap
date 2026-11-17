// Fork: how the roads, railways and trams (layers.ts, rail-layers.ts) are made: lines
// of the background map's tiles, the same over the map and over imagery, in a light
// or a bold look (roads.constants.ts's `{ light, bold }`); bold, over imagery, they
// fade zoomed right in (`{ map, imagery }`). Such values are listed in `varying`:
// the module sets each layer's for its look and the background (index.ts). Widths
// come from the background map's own layers, so they stay in step.
import type { ExpressionSpecification, FilterSpecification, LineLayerSpecification } from 'maplibre-gl'
import baseLayers from '../../../style/style_base.ts'
import { LayerSpecificationWithZIndex } from '../../../style/types.ts'
import * as look from './roads.constants.ts'
import type { Looks } from './roads.constants.ts'

/** Under everything else that's data (the buildings' outlines included). */
const ZORDER = -11

type LinePaint = NonNullable<LineLayerSpecification['paint']>
type PaintProperty = keyof LinePaint
/** A value over the map, and over imagery. */
export type OverEach<T> = { map: T; imagery: T }
/** A value in each look, over the map and imagery alike or not. */
type Varies<T> = Looks<T | OverEach<T>> | OverEach<T>
/** A line's paint, where a value may differ with the look or the background. */
export type Paint = { [P in PaintProperty]?: LinePaint[P] | Varies<LinePaint[P]> }

/** A paint value that differs with the look or the background. */
export interface Varying {
  layerId: string
  property: PaintProperty
  values: Looks<unknown>
}

function isOverEach(value: unknown): value is OverEach<unknown> {
  return typeof value === 'object' && value !== null && 'map' in value && 'imagery' in value
}

function isLooks(value: unknown): value is Looks<unknown> {
  return typeof value === 'object' && value !== null && 'light' in value && 'bold' in value
}

/** A value that varies, in each look (one over the map and imagery: the same in
 * both); undefined for a plain value. */
function asLooks(value: unknown): Looks<unknown> | undefined {
  if (isLooks(value)) return value
  if (isOverEach(value)) return { light: value, bold: value }
  return undefined
}

/** A paint value for a look and a background. */
export function valueFor(values: Looks<unknown>, bold: boolean, overImagery: boolean): unknown {
  const inLook = bold ? values.bold : values.light
  if (!isOverEach(inLook)) return inLook
  return overImagery ? inLook.imagery : inLook.map
}

export const FULL: Looks<number> = { light: 1, bold: 1 }

/** An opacity in a tunnel: see-through (TUNNEL_OPACITY of it). */
export function tunnelOpacity(opacity: Looks<number>, tunnel: boolean): Looks<number> {
  if (!tunnel) return opacity
  return { light: opacity.light * look.TUNNEL_OPACITY, bold: opacity.bold * look.TUNNEL_OPACITY }
}

/** A layer of the background map (its widths and borders are reused, so they stay in step). */
export function mapLayer(id: string): LayerSpecificationWithZIndex {
  const layer = baseLayers.find((l) => l.id === id)
  if (!layer) throw new Error(`The background map has no layer ${id}`)
  return layer
}

export function mapLineWidth(id: string) {
  const layer = mapLayer(id)
  const width = layer.type === 'line' ? layer.paint?.['line-width'] : undefined
  if (width === undefined) throw new Error(`The background map's ${id} has no line width`)
  return width
}

/** A width by zoom (an interpolation, as the map's all are) times `scale`, never
 * under `minimum`. */
export function resized(width: unknown, scale: number, minimum: number): ExpressionSpecification {
  if (!Array.isArray(width) || width[0] !== 'interpolate')
    throw new Error(`Not a width by zoom: ${JSON.stringify(width)}`)
  const [operator, curve, input, ...stops] = width
  // Stops are zoom, width, zoom, width...: only the widths change.
  const widths = stops.map((stop, i) => (i % 2 === 1 ? Math.max(Number(stop) * scale, minimum) : stop))
  return [operator, curve, input, ...widths] as ExpressionSpecification
}

/** Light, as it is (it's over the map only); bold, as it is over the map, and over
 * imagery full strength until zoomed right in, then fading: the photos show the
 * roads there. */
export function fading(opacity: Looks<number>): Looks<number | OverEach<number | ExpressionSpecification>> {
  const overImagery: ExpressionSpecification = [
    'interpolate',
    ['linear'],
    ['zoom'],
    look.FADE_FROM_ZOOM,
    opacity.bold,
    look.FADE_TO_ZOOM,
    opacity.bold * look.FADED
  ]
  return { light: opacity.light, bold: { map: opacity.bold, imagery: overImagery } }
}

/** Shown over imagery only (the map draws its own). */
export const ONLY_OVER_IMAGERY: OverEach<number> = { map: 0, imagery: 1 }

/** An edge width growing from a hairline to its full width as small roads widen. */
export function growing(width: Looks<number>): Looks<ExpressionSpecification> {
  const by = (full: number): ExpressionSpecification => [
    'interpolate',
    ['linear'],
    ['zoom'],
    look.SMALL_EDGE_FROM_ZOOM,
    look.SMALL_EDGE_HAIRLINE,
    look.SMALL_EDGE_FULL_ZOOM,
    full
  ]
  return { light: by(width.light), bold: by(width.bold) }
}

export interface LineFrom {
  sourceLayer?: string
  minzoom?: number
  maxzoom?: number
}

/** Builds the layers, noting each paint value that differs with the look or the
 * background. */
export class Builder {
  layers: LayerSpecificationWithZIndex[] = []
  varying: Varying[] = []

  /** A line from the background map, by default its roads (`from`: another layer, zooms). */
  line(layerId: string, filter: FilterSpecification, paint: Paint, from: LineFrom = {}) {
    const { sourceLayer = 'roads', ...zooms } = from
    this.layers.push({
      id: layerId,
      zorder: ZORDER,
      type: 'line',
      source: 'basemap',
      'source-layer': sourceLayer,
      filter,
      ...zooms,
      // Round ends and joins: a line's pieces meet without a notch (as styles of
      // Planetiler's tiles draw roads); a tunnel's dashes of length 0 are dots.
      layout: { 'line-join': 'round', 'line-cap': 'round' },
      paint: this.overTheMap(layerId, paint)
    })
  }

  /** The paint in the light look over the map; the values that vary noted. */
  private overTheMap(layerId: string, paint: Paint): LinePaint {
    const onMap: Record<string, unknown> = {}
    for (const [property, value] of Object.entries(paint)) {
      const values = asLooks(value)
      if (values) {
        onMap[property] = valueFor(values, false, false)
        this.varying.push({ layerId, property: property as PaintProperty, values })
      } else onMap[property] = value
    }
    return onMap as LinePaint
  }
}
