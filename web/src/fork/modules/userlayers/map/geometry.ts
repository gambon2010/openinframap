// Fork: My layers' geometry, pure: control points, the points that can be moved,
// moving and centring shapes, sizes, the selection's shapes, an image's visible box.
import { UserFeature } from '../model/model.ts'
import { kindOf } from '../kinds/index.ts'
import { axisWidth, axisWidthPoint, squareUp } from '../graphics/graphics.ts'
import { IconBox } from './render.types.ts'
import { MAX_SIZE, MIN_SIZE } from './render.constants.ts'
import { clamp } from '../../../core/math.ts'

/** Drawn by the tactical graphics renderer (graphics.ts). */
export const isGraphic = (f: UserFeature) => kindOf(f.properties).drawn === 'graphic'

export const isMeasure = (f: UserFeature) => kindOf(f.properties).drawn === 'measure'

/** The control points of a graphic (stored as a line through them). */
export function controlPoints(geometry: GeoJSON.Geometry): [number, number][] {
  if (geometry.type === 'LineString' || geometry.type === 'MultiPoint')
    return geometry.coordinates as [number, number][]
  if (geometry.type === 'Point') return [geometry.coordinates as [number, number]]
  if (geometry.type === 'Polygon') return geometry.coordinates[0] as [number, number][]
  return []
}

/** Kinds drawn as an image that the resize handle (and the Size slider) apply to. */
export function resizable(feature: UserFeature | null): boolean {
  return feature?.geometry.type === 'Point' && Boolean(kindOf(feature.properties).sized)
}

/**
 * The size when the resize handle is dragged: how far the pointer is from the
 * centre, against where the handle sits at size 1. Clamped, in steps of 0.05.
 */
export function sizeFromDrag(distance: number, distanceAtSize1: number): number {
  if (!(distanceAtSize1 > 0)) return 1
  const size = Math.round((distance / distanceAtSize1) * 20) / 20
  return clamp(size, MIN_SIZE, MAX_SIZE)
}

/** Items that glow under their own lines when selected (Renderer.highlightItems)
 * rather than have their shape drawn over them: graphics and measurements. */
export const glows = (f: UserFeature) => isGraphic(f) || isMeasure(f)

/** A selected feature as drawn: its shape (unless it glows), and its points as
 * handles when it has more than one. */
export function selectionFeatures(feature: UserFeature): GeoJSON.Feature[] {
  const graphic = isGraphic(feature)
  const points = graphic
    ? squareUp(feature.properties.sidc, controlPoints(feature.geometry))
    : vertices(feature.geometry)
  const out: GeoJSON.Feature[] = glows(feature)
    ? []
    : [{ type: 'Feature', geometry: feature.geometry, properties: {} }]
  // Arrows: the size handle, at the arrowhead's corner. Not part of the path (or of
  // the highlighted line): it only sets the width.
  const p = feature.properties
  if (graphic && (p.axis || p.axisWidth !== undefined) && points.length > 1) {
    out.push({
      type: 'Feature',
      geometry: { type: 'Point', coordinates: axisWidthPoint(points, p.axisWidth ?? axisWidth(points)) },
      properties: { vertex: true, index: -1, width: true }
    })
  }
  if (feature.geometry.type !== 'Point') {
    points.forEach((c, index) =>
      out.push({
        type: 'Feature',
        geometry: { type: 'Point', coordinates: c },
        properties: { vertex: true, index }
      })
    )
  }
  return out
}

/** The points of a drawing that can be moved (a polygon's closing point left out). */
export function vertices(geometry: GeoJSON.Geometry): [number, number][] {
  if (geometry.type === 'LineString') return geometry.coordinates as [number, number][]
  if (geometry.type === 'Polygon') return (geometry.coordinates[0] as [number, number][]).slice(0, -1)
  return []
}

/** A geometry with one of its movable points moved (vertices() order). */
export function moveVertex(
  geometry: GeoJSON.Geometry,
  index: number,
  to: [number, number]
): GeoJSON.Geometry {
  if (geometry.type === 'LineString') {
    const coordinates = geometry.coordinates.map((c, i) => (i === index ? to : c))
    return { type: 'LineString', coordinates }
  }
  if (geometry.type === 'Polygon') {
    const ring = geometry.coordinates[0].map((c, i, all) =>
      i === index || (index === 0 && i === all.length - 1) ? to : c
    )
    return { type: 'Polygon', coordinates: [ring, ...geometry.coordinates.slice(1)] }
  }
  return geometry
}

/** Every position of a geometry moved by the same amount (degrees). */
export function translateGeometry(geometry: GeoJSON.Geometry, dLng: number, dLat: number): GeoJSON.Geometry {
  const move = (c: unknown): unknown =>
    Array.isArray(c) && typeof c[0] === 'number'
      ? [(c[0] as number) + dLng, (c[1] as number) + dLat, ...c.slice(2)]
      : (c as unknown[]).map(move)
  if (geometry.type === 'GeometryCollection') {
    return { ...geometry, geometries: geometry.geometries.map((g) => translateGeometry(g, dLng, dLat)) }
  }
  return { ...geometry, coordinates: move(geometry.coordinates) } as GeoJSON.Geometry
}

/** The middle of a geometry's bounding box. */
export function geometryCentre(geometry: GeoJSON.Geometry): [number, number] {
  const xs: number[] = []
  const ys: number[] = []
  const add = (c: unknown): void => {
    if (Array.isArray(c) && typeof c[0] === 'number') {
      xs.push(c[0] as number)
      ys.push(c[1] as number)
    } else if (Array.isArray(c)) c.forEach(add)
  }
  if (geometry.type === 'GeometryCollection') geometry.geometries.forEach((g) => add(geometryCentre(g)))
  else add(geometry.coordinates)
  if (!xs.length) return [0, 0]
  return [(Math.min(...xs) + Math.max(...xs)) / 2, (Math.min(...ys) + Math.max(...ys)) / 2]
}

/** The box around an image's visible pixels (RGBA, alpha over a small threshold),
 * in px from its centre on screen; the whole image when nothing is visible. */
export function visibleBox(rgba: ArrayLike<number>, width: number, height: number, ratio = 1): IconBox {
  let [x0, y0, x1, y1] = [width, height, -1, -1]
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      if (rgba[(y * width + x) * 4 + 3] > 16) {
        if (x < x0) x0 = x
        if (x > x1) x1 = x
        if (y < y0) y0 = y
        if (y > y1) y1 = y
      }
    }
  }
  if (x1 < 0) [x0, y0, x1, y1] = [0, 0, width - 1, height - 1]
  return {
    left: (x0 - width / 2) / ratio,
    top: (y0 - height / 2) / ratio,
    right: (x1 + 1 - width / 2) / ratio,
    bottom: (y1 + 1 - height / 2) / ratio
  }
}

/** An image's box (px from its centre at size 1) at a size, `pad` pixels bigger each side. */
export function scaledBox(box: IconBox, size: number, pad = 0): IconBox {
  return {
    left: box.left * size - pad,
    top: box.top * size - pad,
    right: box.right * size + pad,
    bottom: box.bottom * size + pad
  }
}
