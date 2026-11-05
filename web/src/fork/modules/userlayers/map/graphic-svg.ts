// Fork: a tactical graphic drawn small, as SVG (a printed legend's picture: ui/legend.ts).
// The real renderer draws it from made-up points in its usual shape (an arrow from
// left to right, a square graphic square, an area as a box), and its lines, areas
// and labels become an SVG fitted to them.
import { graphicKey } from './graphic-labels.ts'
import {
  SQUARE,
  axisControlPoints,
  graphicsLibrary,
  isAxis,
  mapScale,
  pointCount,
  renderGraphic,
  squareUp
} from './graphics.ts'

type LonLat = [number, number]

/** Made-up points a graphic is drawn from, by how many it takes and how. */
export function samplePoints(
  sidc: string,
  count: { min: number; max: number },
  axis: boolean,
  square: { base: [number, number]; free: number } | undefined
): LonLat[] {
  const [w, h] = [0.02, 0.012]
  if (axis)
    return axisControlPoints([
      [0, 0],
      [w, 0]
    ])
  if (square) {
    const points: LonLat[] = []
    points[square.base[0]] = [0, 0]
    points[square.base[1]] = [w, 0]
    points[square.free] = [w / 2, h]
    return squareUp(sidc, points)
  }
  if (count.min <= 1) return [[w / 2, h / 2]]
  if (count.min === 2)
    return [
      [0, h / 2],
      [w, h / 2]
    ]
  if (count.max >= 4)
    return [
      [0, 0],
      [w, 0],
      [w, h],
      [0, h]
    ]
  return [
    [0, 0],
    [w, 0],
    [w / 2, h]
  ]
}

const escape = (text: string) => text.replace(/[&<>"]/g, (c) => `&#${c.charCodeAt(0)};`)

/** A graphic drawn small in `colour` (none: the renderer's, as on the map), as SVG,
 * and the labels written on it (null: the renderer can't draw it). */
export async function graphicSvg(
  sidc: string,
  colour?: string
): Promise<{ svg: string; labels: string[] } | null> {
  const lib = await graphicsLibrary()
  const count = pointCount(lib, sidc)
  if (!count) return null
  const points = samplePoints(sidc, count, isAxis(lib, sidc), SQUARE[graphicKey(sidc)])
  let pieces: GeoJSON.Feature[]
  try {
    pieces = renderGraphic(lib, {
      sidc,
      points,
      ...(colour ? { color: colour } : {}),
      scale: mapScale(13, 0)
    })
  } catch {
    return null
  }
  // Everything's extent, to fit the picture to it (y up on the map, down in SVG).
  const xs: number[] = []
  const ys: number[] = []
  const rings = (g: GeoJSON.Geometry): number[][][] =>
    g.type === 'LineString'
      ? [g.coordinates]
      : g.type === 'MultiLineString' || g.type === 'Polygon'
        ? g.coordinates
        : g.type === 'MultiPolygon'
          ? g.coordinates.flat()
          : []
  for (const piece of pieces) {
    for (const ring of rings(piece.geometry))
      for (const [x, y] of ring) {
        xs.push(x)
        ys.push(y)
      }
    if (piece.geometry.type === 'Point') {
      xs.push(piece.geometry.coordinates[0])
      ys.push(piece.geometry.coordinates[1])
    }
  }
  if (!xs.length) return null
  const [x0, x1, y0, y1] = [Math.min(...xs), Math.max(...xs), Math.min(...ys), Math.max(...ys)]
  const size = Math.max(x1 - x0, y1 - y0) || 1
  const k = 56 / size
  const width = Math.max(8, (x1 - x0) * k + 8)
  const height = Math.max(8, (y1 - y0) * k + 8)
  const at = ([x, y]: number[]) => `${((x - x0) * k + 4).toFixed(1)},${((y1 - y) * k + 4).toFixed(1)}`
  let body = ''
  for (const piece of pieces) {
    const p = (piece.properties ?? {}) as Record<string, unknown>
    const stroke = (p.stroke as string) ?? colour ?? '#000000'
    const g = piece.geometry
    if (g.type === 'Point' && p.label) {
      body += `<text x="${at(g.coordinates).split(',')[0]}" y="${at(g.coordinates).split(',')[1]}" font-size="9" font-family="sans-serif" text-anchor="middle" dominant-baseline="middle" fill="${(p.color as string) ?? colour ?? '#000000'}">${escape(String(p.label))}</text>`
      continue
    }
    const polygon = g.type === 'Polygon' || g.type === 'MultiPolygon'
    const fill = polygon && p.fill ? `fill="${p.fill}" fill-opacity="${p.fillOpacity ?? 0.3}"` : 'fill="none"'
    for (const ring of rings(g)) {
      const tag = polygon ? 'polygon' : 'polyline'
      body += `<${tag} points="${ring.map(at).join(' ')}" ${fill} stroke="${stroke}" stroke-width="1.6" stroke-linejoin="round"${p.dashed ? ' stroke-dasharray="4 3"' : ''}/>`
    }
  }
  const labels = [...new Set(pieces.map((p) => String(p.properties?.label ?? '').trim()).filter(Boolean))]
  return {
    labels,
    svg: `<svg xmlns="http://www.w3.org/2000/svg" width="${width.toFixed(0)}" height="${height.toFixed(0)}" viewBox="0 0 ${width.toFixed(1)} ${height.toFixed(1)}">${body}</svg>`
  }
}
