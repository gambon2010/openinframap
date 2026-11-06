// Fork: tactical graphics (lines, areas, arrows: axis of advance, phase line, block,
// breach...) for "My layers", drawn by the US Army C5ISR renderer
// (@armyc2.c5isr.renderer/mil-sym-ts-web, Apache-2.0). It draws MIL-STD-2525D/E;
// items are stored with their 2525C code (as in ODIN and our catalogue) and
// converted with its C2DLookup. Loaded on first use (a 1.4 MB gzipped script).
// What it returns is GeoJSON (lines, polygons, and label points) that MapLibre draws.

import { graphicKey, labelLanguage, plainLabel } from './labels.ts'
import { metresPerPixel, toRadians } from '../../../core/geo.ts'
import type { C5Ren, PointCount, LonLat, GraphicInput } from './graphics.types.ts'
import {
  BEYOND_C,
  METRES_PER_DEGREE_LON_AT_EQUATOR,
  METRES_PER_DEGREE_LAT,
  OGC_PIXEL_M,
  SQUARE
} from './graphics.constants.ts'

let library: Promise<C5Ren> | undefined

/** The renderer once loaded (null before): for what has to be answered at once. */
let ready: C5Ren | null = null

/** The renderer, loaded once. */
export function graphicsLibrary(): Promise<C5Ren> {
  library ??= import('@armyc2.c5isr.renderer/mil-sym-ts-web').then(async (lib) => {
    await lib.initialize()
    ready = lib
    return lib
  })
  return library
}

/** Whether the renderer has loaded. */
export function graphicsReady(): boolean {
  return ready !== null
}

/**
 * A graphic's name in the standard (the renderer's), for codes our catalogue doesn't
 * list: a saved item of a type the picker no longer offers keeps a name. Null until
 * the renderer has loaded (it loads with the first graphic drawn).
 */
export function standardName(sidc: string): string | null {
  if (!ready) return null
  const code = toDCode(ready, sidc)
  return (code && ready.MSLookup.getInstance().getMSLInfo(code)?.getName()) || null
}

/** A 2525C code as the renderer's 2525D code, or null if it has none. */
export function toDCode(lib: C5Ren, sidc: string): string | null {
  const known = lib.C2DLookup.getInstance().getDCode(sidc)
  if (known) return known
  // Not in 2525C, but in 2525D (BEYOND_C): a sibling's code with its entity swapped,
  // which keeps the affiliation and status the conversion gives.
  const beyond = BEYOND_C[graphicKey(sidc)]
  if (!beyond) return null
  const sibling = lib.C2DLookup.getInstance().getDCode(withSiblingKey(sidc, beyond.sibling))
  return sibling ? sibling.slice(0, 10) + beyond.entity + sibling.slice(16) : null
}

/** A code with another graphic's key, its affiliation and status kept. */
function withSiblingKey(sidc: string, key: string): string {
  const out = sidc.padEnd(15, '-').split('')
  const rest = key.slice(4)
  for (let i = 0; i < 6; i++) out[4 + i] = rest[i] ?? '-'
  return out.join('')
}

export function pointCount(lib: C5Ren, sidc: string): PointCount | null {
  const code = toDCode(lib, sidc)
  if (!code) return null
  const info = lib.MSLookup.getInstance().getMSLInfo(code)
  if (!info) return null
  return { min: info.getMinPointCount(), max: info.getMaxPointCount() }
}

/**
 * Arrows (axis of advance, main and supporting attack...): the standard wants the
 * tip first, then the centre line back to the tail, then a point setting the width.
 * Clicking those in order is awkward, so they're drawn as a path from tail to tip
 * (like any line) plus a width in metres, set by a separate size handle at the
 * arrowhead's corner. These turn that into the renderer's points.
 */
export function isAxis(lib: C5Ren, sidc: string): boolean {
  const code = toDCode(lib, sidc)
  const rule = code ? lib.MSLookup.getInstance().getMSLInfo(code)?.getDrawRule() : undefined
  return rule === lib.DrawRules.AXIS1 || rule === lib.DrawRules.AXIS2
}

/** Metres east/north of an origin. */
function toMetres([lon, lat]: LonLat, origin: LonLat): [number, number] {
  const k = METRES_PER_DEGREE_LON_AT_EQUATOR * Math.cos(toRadians(origin[1]))
  return [(lon - origin[0]) * k, (lat - origin[1]) * METRES_PER_DEGREE_LAT]
}

/** A point `x` metres east and `y` north of an origin. */
function fromMetres([x, y]: [number, number], origin: LonLat): LonLat {
  const k = METRES_PER_DEGREE_LON_AT_EQUATOR * Math.cos(toRadians(origin[1]))
  return [origin[0] + x / k, origin[1] + y / METRES_PER_DEGREE_LAT]
}

/** Length of a path, in metres. */
export function pathLength(path: LonLat[]): number {
  let total = 0
  for (let i = 1; i < path.length; i++) {
    const [x, y] = toMetres(path[i], path[i - 1])
    total += Math.hypot(x, y)
  }
  return total
}

/** A new arrow's width: a fifth of its length, at least 10 m. */
export function axisWidth(path: LonLat[]): number {
  return Math.max(10, Math.round(pathLength(path) / 5))
}

/** The corner of the arrowhead, for a path from tail to tip: the standard's width point. */
export function axisWidthPoint(path: LonLat[], width: number): LonLat {
  const tip = path[path.length - 1]
  const [dx, dy] = toMetres(path[path.length - 2], tip) // towards the previous point
  const length = Math.hypot(dx, dy) || 1
  const [ux, uy] = [dx / length, dy / length]
  // Half a width back from the tip, half a width to the left.
  const back = [ux * (width / 2), uy * (width / 2)]
  return fromMetres([back[0] + uy * (width / 2), back[1] - ux * (width / 2)], tip)
}

/** The renderer's points for an arrow: tip, centre line back to the tail, width point. */
export function axisControlPoints(path: LonLat[], width = axisWidth(path)): LonLat[] {
  return [...path].reverse().concat([axisWidthPoint(path, width)])
}

/**
 * The width an arrow gets when its size handle is dragged to a point: twice the
 * point's distance from the last stretch of the path (at least 10 m). Only the
 * width changes, so wherever the handle goes the arrow keeps its shape.
 */
export function axisWidthFrom(path: LonLat[], handle: LonLat): number {
  const tip = path[path.length - 1]
  const [dx, dy] = toMetres(path[path.length - 2], tip)
  const length = Math.hypot(dx, dy) || 1
  const [hx, hy] = toMetres(handle, tip)
  return Math.max(10, Math.round((2 * Math.abs(hx * dy - hy * dx)) / length))
}

/**
 * An arrow drawn before arrows were paths had the standard's points: tip, centre
 * line back to the tail, then the width point. Its path, tail to tip (the width
 * point becomes its width: axisWidthFrom).
 */
export function pathFromAxisPoints(points: LonLat[]): LonLat[] {
  return points.slice(0, -1).reverse()
}

/** Map scale (1:n) at a zoom and latitude, as the renderer wants it. */
export function mapScale(zoom: number, latitude: number): number {
  // Metres per pixel / metres per screen pixel (0.28 mm, the OGC standard).
  return metresPerPixel(latitude, zoom) / OGC_PIXEL_M
}

/**
 * The graphic as GeoJSON features: lines and polygons with their stroke/fill colours,
 * and points for the labels. Throws if the renderer reports an error.
 */
export function renderGraphic(lib: C5Ren, input: GraphicInput): GeoJSON.Feature[] {
  const code = toDCode(lib, input.sidc)
  if (!code) throw new Error(`No 2525D equivalent for ${input.sidc}`)
  const points = input.points.map(([lon, lat]) => `${lon},${lat}`).join(' ')
  const modifiers = new Map<string, string>()
  const keys = modifierKeys(lib)
  for (const [key, value] of Object.entries(input.modifiers ?? {})) {
    const id = keys[key]
    if (id && value) modifiers.set(id, value)
  }
  const attributes = new Map<string, string>()
  if (input.color) attributes.set(lib.MilStdAttributes.LineColor, input.color.replace('#', ''))
  const bbox = input.bbox ? input.bbox.join(',') : ''
  const out = lib.WebRenderer.RenderSymbol(
    'g',
    '',
    '',
    code,
    points,
    'clampToGround',
    input.scale,
    bbox,
    modifiers,
    attributes,
    lib.WebRenderer.OUTPUT_FORMAT_GEOJSON
  )
  const parsed = JSON.parse(out)
  if (parsed.type !== 'FeatureCollection') {
    throw new Error(parsed.error || parsed.message || 'Could not draw this graphic')
  }
  const language = input.language === undefined ? labelLanguage() : input.language
  return (parsed.features as GeoJSON.Feature[])
    .map(normalise)
    .filter((f): f is GeoJSON.Feature => f !== null)
    .flatMap((f) => {
      // The standard's text, as chosen (graphic-labels.ts); '' = not written.
      if (f.geometry.type !== 'Point' || !f.properties?.label) return [f]
      const label = plainLabel(input.sidc, String(f.properties.label), language)
      return label.trim() ? [{ ...f, properties: { ...f.properties, label } }] : []
    })
}

// The renderer's modifier keys for the 2525C letters we store.
export function modifierKeys(lib: C5Ren): Record<string, string> {
  const m = lib.Modifiers
  return {
    T: m.T_UNIQUE_DESIGNATION_1,
    T1: m.T1_UNIQUE_DESIGNATION_2,
    H: m.H_ADDITIONAL_INFO_1,
    H1: m.H1_ADDITIONAL_INFO_2,
    W: m.W_DTG_1,
    W1: m.W1_DTG_2,
    X: m.X_ALTITUDE_DEPTH,
    AM: m.AM_DISTANCE,
    AN: m.AN_AZIMUTH
  }
}

// The renderer's GeoJSON: lines and polygons with strokeColor / fillColor /
// strokeWidth, points with a label (fontColor, angle), and one polygon carrying the
// symbol's metadata (symbolID...), which isn't drawn.
function normalise(feature: GeoJSON.Feature): GeoJSON.Feature | null {
  const p = (feature.properties ?? {}) as Record<string, unknown>
  if ('symbolID' in p) return null
  const isLabel = feature.geometry.type === 'Point'
  if (isLabel && !p['label']) return null
  // A shape filled with no outline colour (an arrowhead): outlined in its fill, not
  // in the layer's colour, which the map would use instead.
  const stroke =
    colour(p['strokeColor']) ?? (feature.geometry.type.endsWith('Polygon') ? colour(p['fillColor']) : null)
  return {
    type: 'Feature',
    geometry: feature.geometry,
    properties: isLabel
      ? {
          label: String(p['label']),
          color: colour(p['fontColor']) ?? '#000000',
          halo: haloFor(colour(p['fontColor']) ?? '#000000'),
          angle: Number(p['angle'] ?? p['rotation'] ?? 0) || 0,
          align: p['labelAlign'] === 'left' || p['labelAlign'] === 'right' ? p['labelAlign'] : 'center'
        }
      : {
          stroke,
          // Light lines (yellow) get a dark edge, or they vanish on the light map.
          casing: haloFor(stroke ?? '#000000') === '#1a1a1a' ? '#1a1a1a' : null,
          fill: colour(p['fillColor']),
          fillOpacity: Number(p['fillOpacity'] ?? 0.3),
          width: Number(p['strokeWidth'] ?? 2) || 2,
          dashed: Array.isArray(p['strokeDasharray']) && p['strokeDasharray'].length > 0
        }
  }
}

/**
 * The outline that keeps a label readable: dark around light text (yellow, the
 * colour of unknown / pending graphics), white around dark text.
 */
export function haloFor(textColour: string): string {
  const hex = textColour.replace('#', '')
  const [r, g, b] = [0, 2, 4].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255)
  // Relative luminance (sRGB weights, without the gamma curve: enough to choose).
  const luminance = 0.2126 * r + 0.7152 * g + 0.0722 * b
  return luminance > 0.6 ? '#1a1a1a' : '#ffffff'
}

/** '#FF00FF00' (AARRGGBB) or '#00FF00' -> '#00ff00' (alpha dropped: the layer sets it). */
export function colour(value: unknown): string | null {
  if (typeof value !== 'string' || !value) return null
  const hex = value.replace('#', '')
  if (hex.length === 8) return `#${hex.slice(2).toLowerCase()}`
  if (hex.length === 6) return `#${hex.toLowerCase()}`
  return null
}

/**
 * A square graphic's points with the third moved onto the perpendicular through the
 * base's middle (or its point, see SQUARE), keeping its distance from the base;
 * anything else as it is.
 */
export function squareUp(sidc: string | undefined, points: LonLat[]): LonLat[] {
  const rule = sidc ? SQUARE[graphicKey(sidc)] : undefined
  if (!rule || points.length !== 3) return points
  const a = points[rule.base[0]]
  const b = points[rule.base[1]]
  const mid: LonLat =
    rule.through === undefined ? [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2] : points[rule.through]
  const [bx, by] = toMetres(b, a)
  const length = Math.hypot(bx, by)
  if (!length) return points
  // The base's normal, and how far the free point is along it.
  const [nx, ny] = [-by / length, bx / length]
  const [fx, fy] = toMetres(points[rule.free], mid)
  const along = fx * nx + fy * ny
  const out = [...points]
  out[rule.free] = fromMetres([nx * along, ny * along], mid)
  return out
}
