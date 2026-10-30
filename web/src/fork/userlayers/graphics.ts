// Fork: tactical graphics (lines, areas, arrows: axis of advance, phase line, block,
// breach...) for "My layers", drawn by the US Army C5ISR renderer
// (@armyc2.c5isr.renderer/mil-sym-ts-web, Apache-2.0). It draws MIL-STD-2525D/E;
// items are stored with their 2525C code (as in ODIN and our catalogue) and
// converted with its C2DLookup. Loaded on first use (a 1.4 MB gzipped script).
// What it returns is GeoJSON (lines, polygons, and label points) that MapLibre draws.

type C5Ren = typeof import('@armyc2.c5isr.renderer/mil-sym-ts-web')

let library: Promise<C5Ren> | undefined

/** The renderer, loaded once. */
export function graphicsLibrary(): Promise<C5Ren> {
  library ??= import('@armyc2.c5isr.renderer/mil-sym-ts-web').then(async (lib) => {
    await lib.initialize()
    return lib
  })
  return library
}

/** How many control points a graphic takes. */
export interface PointCount {
  min: number
  max: number
}

/** A 2525C code as the renderer's 2525D code, or null if it has none. */
export function toDCode(lib: C5Ren, sidc: string): string | null {
  return lib.C2DLookup.getInstance().getDCode(sidc) || null
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
 * (like any line); the width follows from the path, so every arrow has the same
 * proportions. These turn the path into the renderer's points.
 */
export function isAxis(lib: C5Ren, sidc: string): boolean {
  const code = toDCode(lib, sidc)
  const rule = code ? lib.MSLookup.getInstance().getMSLInfo(code)?.getDrawRule() : undefined
  return rule === lib.DrawRules.AXIS1 || rule === lib.DrawRules.AXIS2
}

type LonLat = [number, number]

/** Metres east/north of an origin (equirectangular: fine at the scale of an arrow). */
function toMetres([lon, lat]: LonLat, origin: LonLat): [number, number] {
  const k = 111_320 * Math.cos((origin[1] * Math.PI) / 180)
  return [(lon - origin[0]) * k, (lat - origin[1]) * 110_540]
}

function fromMetres([x, y]: [number, number], origin: LonLat): LonLat {
  const k = 111_320 * Math.cos((origin[1] * Math.PI) / 180)
  return [origin[0] + x / k, origin[1] + y / 110_540]
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

/** An arrow's width: a fifth of its length (at least 10 m). */
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
export function axisControlPoints(path: LonLat[]): LonLat[] {
  return [...path].reverse().concat([axisWidthPoint(path, axisWidth(path))])
}

/** Map scale (1:n) at a zoom and latitude, as the renderer wants it. */
export function mapScale(zoom: number, latitude: number): number {
  // Metres per pixel (512 px tiles) / metres per screen pixel (0.28 mm, the OGC standard).
  const metresPerPixel = (40075016.686 * Math.cos((latitude * Math.PI) / 180)) / (512 * 2 ** zoom)
  return metresPerPixel / 0.00028
}

export interface GraphicInput {
  /** 2525C code, 15 characters. */
  sidc: string
  /** Control points, [lon, lat]. */
  points: [number, number][]
  /** Text modifiers, keyed by 2525 letter (T, T1, H, W, W1...). */
  modifiers?: Record<string, string>
  color?: string
  /** 1:n */
  scale: number
  /** [west, south, east, north] of the view. */
  bbox?: [number, number, number, number]
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
  return (parsed.features as GeoJSON.Feature[]).map(normalise).filter((f): f is GeoJSON.Feature => f !== null)
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
          stroke: colour(p['strokeColor']),
          // Light lines (yellow) get a dark edge, or they vanish on the light map.
          casing: haloFor(colour(p['strokeColor']) ?? '#000000') === '#1a1a1a' ? '#1a1a1a' : null,
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
