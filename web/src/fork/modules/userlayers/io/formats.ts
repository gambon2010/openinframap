// Fork: My layers to and from files (docs/SPECIFICATIONS.md 10.7): GeoJSON, KML
// and GPX. Exported items keep what they are (kind, symbol code, details) in their
// properties (GeoJSON) or ExtendedData (KML), so a file exported here comes back as
// it was; files from elsewhere become markers (points) and drawings (lines,
// areas), with their name, and their other fields in the notes. Pure, except for
// DOMParser (KML, GPX).
import { gpx, kml } from '@tmcw/togeojson'
import { FeatureProps, UserLayer } from '../model/model.ts'
import { KIND_IDS, kindOf } from '../kinds/index.ts'

export type Format = 'geojson' | 'kml' | 'gpx'

export const EXTENSIONS: Record<Format, string> = { geojson: 'geojson', kml: 'kml', gpx: 'gpx' }
export const MIME: Record<Format, string> = {
  geojson: 'application/geo+json',
  kml: 'application/vnd.google-earth.kml+xml',
  gpx: 'application/gpx+xml'
}

/** An item to make on import. */
export interface Imported {
  geometry: GeoJSON.Geometry
  properties: FeatureProps
}

// What says what an item is in My layers (kept on export, read back on import).
const OWN = [
  'kind',
  'sidc',
  'modifiers',
  'axis',
  'axisWidth',
  'size',
  'color',
  'width',
  'image',
  'copy',
  'measure',
  'radii',
  'locked'
]

// ---------------------------------------------------------------------------------
// Export

/** One GeoJSON file of the layers: each item with its layer's name. */
export function toGeoJSON(layers: UserLayer[]): string {
  const features = layers.flatMap((layer) =>
    [...layer.features.values()].map((f) => ({
      type: 'Feature',
      id: f.id,
      geometry: f.geometry,
      properties: { ...f.properties, layer: layer.name }
    }))
  )
  return JSON.stringify({ type: 'FeatureCollection', features }, null, 1)
}

const escapeXml = (s: string) =>
  s.replace(/[<>&'"]/g, (c) => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;', "'": '&apos;', '"': '&quot;' })[c]!)

const coords = (c: GeoJSON.Position[]) => c.map((p) => `${p[0]},${p[1]}`).join(' ')

function kmlGeometry(g: GeoJSON.Geometry): string {
  switch (g.type) {
    case 'Point':
      return `<Point><coordinates>${coords([g.coordinates])}</coordinates></Point>`
    case 'LineString':
      return `<LineString><tessellate>1</tessellate><coordinates>${coords(g.coordinates)}</coordinates></LineString>`
    case 'Polygon':
      return (
        '<Polygon>' +
        g.coordinates
          .map(
            (ring, i) =>
              `<${i ? 'innerBoundaryIs' : 'outerBoundaryIs'}><LinearRing><coordinates>${coords(ring)}</coordinates></LinearRing></${i ? 'innerBoundaryIs' : 'outerBoundaryIs'}>`
          )
          .join('') +
        '</Polygon>'
      )
    case 'MultiPoint':
    case 'MultiLineString':
    case 'MultiPolygon':
      return `<MultiGeometry>${explode(g).map(kmlGeometry).join('')}</MultiGeometry>`
    case 'GeometryCollection':
      return `<MultiGeometry>${g.geometries.map(kmlGeometry).join('')}</MultiGeometry>`
  }
}

/** "#d32f2f" → KML's aabbggrr. */
function kmlColour(hex: string, alpha = 'ff'): string {
  const m = /^#?([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/i.exec(hex)
  return m ? `${alpha}${m[3]}${m[2]}${m[1]}`.toLowerCase() : `${alpha}2f2fd3`
}

/** The text that describes an item: its notes and details. */
function description(p: FeatureProps): string {
  const lines = Object.entries(p.modifiers ?? {}).map(([k, v]) => `${k}: ${v}`)
  if (p.notes) lines.unshift(p.notes)
  return lines.join('\n')
}

/** One KML file: a folder per layer, each item with its colour. */
export function toKML(layers: UserLayer[], title = 'My layers'): string {
  const folders = layers.map((layer) => {
    const placemarks = [...layer.features.values()].map((f) => {
      const p = f.properties
      const colour = p.color ?? layer.style.color ?? '#d32f2f'
      const own = [...OWN, 'notes']
        .filter((k) => p[k] !== undefined)
        .map((k) => {
          const value = typeof p[k] === 'object' ? JSON.stringify(p[k]) : String(p[k])
          return `<Data name="oim:${k}"><value>${escapeXml(value)}</value></Data>`
        })
        .join('')
      const desc = description(p)
      return (
        '<Placemark>' +
        (p.name ? `<name>${escapeXml(p.name)}</name>` : '') +
        (desc ? `<description>${escapeXml(desc)}</description>` : '') +
        `<Style><IconStyle><color>${kmlColour(colour)}</color></IconStyle>` +
        `<LineStyle><color>${kmlColour(colour)}</color><width>${p.width ?? 3}</width></LineStyle>` +
        `<PolyStyle><color>${kmlColour(colour, '40')}</color></PolyStyle></Style>` +
        (own ? `<ExtendedData>${own}</ExtendedData>` : '') +
        kmlGeometry(f.geometry) +
        '</Placemark>'
      )
    })
    return `<Folder><name>${escapeXml(layer.name)}</name>${placemarks.join('\n')}</Folder>`
  })
  return (
    '<?xml version="1.0" encoding="UTF-8"?>\n' +
    '<kml xmlns="http://www.opengis.net/kml/2.2"><Document>' +
    `<name>${escapeXml(title)}</name>\n${folders.join('\n')}\n</Document></kml>\n`
  )
}

/** One GPX file: points as waypoints, lines and area outlines as tracks. GPX has no
 * areas, symbols or colours: those are lost. */
export function toGPX(layers: UserLayer[]): string {
  const waypoints: string[] = []
  const tracks: string[] = []
  for (const layer of layers) {
    for (const f of layer.features.values()) {
      const p = f.properties
      const name = p.name ? `<name>${escapeXml(p.name)}</name>` : ''
      const desc = description(p) ? `<desc>${escapeXml(description(p))}</desc>` : ''
      const type = `<type>${escapeXml(layer.name)}</type>`
      for (const g of explode(f.geometry)) {
        if (g.type === 'Point') {
          waypoints.push(
            `<wpt lat="${g.coordinates[1]}" lon="${g.coordinates[0]}">${name}${desc}${type}</wpt>`
          )
          continue
        }
        const parts = g.type === 'LineString' ? [g.coordinates] : g.type === 'Polygon' ? g.coordinates : []
        if (!parts.length) continue
        const segments = parts
          .map(
            (part) => `<trkseg>${part.map((c) => `<trkpt lat="${c[1]}" lon="${c[0]}"/>`).join('')}</trkseg>`
          )
          .join('')
        tracks.push(`<trk>${name}${desc}${type}${segments}</trk>`)
      }
    }
  }
  return (
    '<?xml version="1.0" encoding="UTF-8"?>\n' +
    '<gpx version="1.1" creator="Open Infrastructure Map" xmlns="http://www.topografix.com/GPX/1/1">\n' +
    [...waypoints, ...tracks].join('\n') +
    '\n</gpx>\n'
  )
}

export function exportLayers(layers: UserLayer[], format: Format, title?: string): string {
  if (format === 'kml') return toKML(layers, title)
  if (format === 'gpx') return toGPX(layers)
  return toGeoJSON(layers)
}

// ---------------------------------------------------------------------------------
// Import

/** Multi-geometries and collections as single ones. */
export function explode(
  g: GeoJSON.Geometry | null
): (GeoJSON.Point | GeoJSON.LineString | GeoJSON.Polygon)[] {
  if (!g) return []
  switch (g.type) {
    case 'Point':
    case 'LineString':
    case 'Polygon':
      return [g]
    case 'MultiPoint':
      return g.coordinates.map((coordinates) => ({ type: 'Point', coordinates }))
    case 'MultiLineString':
      return g.coordinates.map((coordinates) => ({ type: 'LineString', coordinates }))
    case 'MultiPolygon':
      return g.coordinates.map((coordinates) => ({ type: 'Polygon', coordinates }))
    case 'GeometryCollection':
      return g.geometries.flatMap(explode)
  }
}

/** Positions in two dimensions (heights and times dropped). */
function flat<T extends GeoJSON.Point | GeoJSON.LineString | GeoJSON.Polygon>(g: T): T {
  const p2 = (p: GeoJSON.Position) => [p[0], p[1]]
  if (g.type === 'Point') return { ...g, coordinates: p2(g.coordinates) }
  if (g.type === 'LineString') return { ...g, coordinates: g.coordinates.map(p2) }
  return { ...g, coordinates: (g as GeoJSON.Polygon).coordinates.map((r) => r.map(p2)) } as T
}

const NAME_KEYS = ['name', 'Name', 'NAME', 'title', 'Title', 'label']
const NOTE_KEYS = ['description', 'desc', 'notes', 'Description', 'cmt']
// What KML and GPX readers add about the look: not worth keeping as notes.
const STYLE_KEYS =
  /^(stroke|fill|marker|icon|label|styleUrl|styleHash|styleMapHash|visibility|_gpxType|times|coordinateProperties)/

/** A file's feature as an item of My layers. */
export function toItem(geometry: GeoJSON.Geometry, raw: Record<string, unknown>): Imported {
  // KML's ExtendedData (oim:...), as togeojson reads it, or GeoJSON's own keys.
  const read = (key: string): unknown => {
    const value = raw[`oim:${key}`] ?? raw[key]
    if (
      typeof value !== 'string' ||
      !['modifiers', 'copy', 'axis', 'axisWidth', 'size', 'width', 'radii', 'locked'].includes(key)
    )
      return value
    try {
      return JSON.parse(value)
    } catch {
      return value
    }
  }
  const kind = read('kind')
  const name = NAME_KEYS.map((k) => raw[k]).find((v) => typeof v === 'string' && v.trim()) as
    string | undefined
  const notes = NOTE_KEYS.map((k) => raw[k]).find((v) => typeof v === 'string' && v.trim()) as
    string | undefined
  if (typeof kind === 'string' && KIND_IDS.includes(kind)) {
    // Exported from My layers: as it was. A copy of a map feature keeps all the
    // original's fields (it's drawn from them).
    const properties: FeatureProps =
      kindOf({ kind: kind as FeatureProps['kind'] }).drawn === 'copy'
        ? (Object.fromEntries(
            Object.entries(raw).filter(([k]) => k !== 'layer' && !k.startsWith('oim:'))
          ) as FeatureProps)
        : { kind: kind as FeatureProps['kind'] }
    for (const key of OWN) if (read(key) !== undefined) properties[key] = read(key)
    if (name) properties.name = name
    // Notes: their own field (KML's description also has the details, for other programs).
    const own = raw['oim:notes'] ?? raw.notes
    if (typeof own === 'string' && own) properties.notes = own
    else delete properties.notes
    return { geometry, properties }
  }
  const properties: FeatureProps = { kind: geometry.type === 'Point' ? 'marker' : 'drawing' }
  if (name) properties.name = name
  const colour = [raw.stroke, raw['marker-color'], raw.fill].find(
    (v) => typeof v === 'string' && /^#[0-9a-f]{6}$/i.test(v)
  )
  if (colour) properties.color = colour as string
  // The other fields, in the notes.
  const others = Object.entries(raw)
    .filter(
      ([k, v]) =>
        ![...NAME_KEYS, ...NOTE_KEYS, 'layer'].includes(k) &&
        !k.startsWith('oim:') &&
        !STYLE_KEYS.test(k) &&
        v !== null &&
        v !== '' &&
        typeof v !== 'object'
    )
    .map(([k, v]) => `${k}: ${v}`)
  const text = [notes, ...others].filter(Boolean).join('\n')
  if (text) properties.notes = text
  return { geometry, properties }
}

function features(
  data: unknown
): { geometry: GeoJSON.Geometry | null; properties: Record<string, unknown> }[] {
  const d = data as { type?: string; features?: unknown[]; geometry?: unknown; properties?: unknown }
  if (d?.type === 'FeatureCollection' && Array.isArray(d.features)) return d.features.flatMap(features)
  if (d?.type === 'Feature')
    return [
      {
        geometry: (d.geometry ?? null) as GeoJSON.Geometry | null,
        properties: (d.properties ?? {}) as Record<string, unknown>
      }
    ]
  if (typeof d?.type === 'string') return [{ geometry: d as GeoJSON.Geometry, properties: {} }]
  return []
}

/** What format a file is, from its name or its first characters. */
export function formatOf(fileName: string, text: string): Format | null {
  const ext = fileName.toLowerCase().split('.').pop()
  if (ext === 'kml') return 'kml'
  if (ext === 'gpx') return 'gpx'
  if (ext === 'geojson' || ext === 'json') return 'geojson'
  const start = text.trimStart().slice(0, 400)
  if (start.startsWith('{')) return 'geojson'
  if (/<kml\b/.test(start)) return 'kml'
  if (/<gpx\b/.test(start)) return 'gpx'
  return null
}

/** A file's items (empty if it has none); throws if it can't be read. */
export function readFile(fileName: string, text: string): Imported[] {
  const format = formatOf(fileName, text)
  if (!format) throw new Error('unknown format')
  let data: unknown
  if (format === 'geojson') data = JSON.parse(text)
  else {
    const doc = new DOMParser().parseFromString(text, 'text/xml')
    if (doc.getElementsByTagName('parsererror').length) throw new Error('not valid XML')
    data = format === 'kml' ? kml(doc) : gpx(doc)
  }
  return features(data).flatMap(({ geometry, properties }) =>
    explode(geometry)
      .filter((g) => valid(g))
      .map((g) => toItem(flat(g), properties))
  )
}

/** Coordinates that are numbers, a line with two points, an area with a ring. */
function valid(g: GeoJSON.Point | GeoJSON.LineString | GeoJSON.Polygon): boolean {
  const ok = (p: GeoJSON.Position) => Number.isFinite(p[0]) && Number.isFinite(p[1])
  if (g.type === 'Point') return ok(g.coordinates)
  if (g.type === 'LineString') return g.coordinates.length >= 2 && g.coordinates.every(ok)
  return g.coordinates.length > 0 && g.coordinates[0].length >= 4 && g.coordinates.every((r) => r.every(ok))
}
