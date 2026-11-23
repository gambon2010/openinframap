// Fork: areas that can't be: one whose outline crosses itself (a bow tie) has no
// inside or area to speak of, so My layers doesn't let one be made (drawn,
// measured, a point dragged, a leg's length typed). Checked on the flat map, as
// it's seen (Web Mercator). Pure.
type Pt = [number, number]

function merc([lng, lat]: Pt): Pt {
  return [(lng + 180) / 360, (1 - Math.log(Math.tan(Math.PI / 4 + (lat * Math.PI) / 360)) / Math.PI) / 2]
}

/** Which side of a→b point c is on (0: on its line). */
function side(a: Pt, b: Pt, c: Pt): number {
  const v = (b[0] - a[0]) * (c[1] - a[1]) - (b[1] - a[1]) * (c[0] - a[0])
  return Math.abs(v) < 1e-18 ? 0 : Math.sign(v)
}

function within(a: Pt, b: Pt, c: Pt): boolean {
  return (
    Math.min(a[0], b[0]) <= c[0] &&
    c[0] <= Math.max(a[0], b[0]) &&
    Math.min(a[1], b[1]) <= c[1] &&
    c[1] <= Math.max(a[1], b[1])
  )
}

/** Whether segments p-q and r-s cross or touch. */
export function segmentsMeet(p: Pt, q: Pt, r: Pt, s: Pt): boolean {
  const [d1, d2, d3, d4] = [side(r, s, p), side(r, s, q), side(p, q, r), side(p, q, s)]
  if (d1 * d2 < 0 && d3 * d4 < 0) return true
  // Touching or overlapping (on the same line).
  return (
    (d1 === 0 && within(r, s, p)) ||
    (d2 === 0 && within(r, s, q)) ||
    (d3 === 0 && within(p, q, r)) ||
    (d4 === 0 && within(p, q, s))
  )
}

/** Whether a path (open: its ends aren't joined) crosses itself. Edges that follow
 * each other share their point, which doesn't count. */
export function pathCrossesItself(points: Pt[], closed = false): boolean {
  const ps = points.map(merc)
  const edges: [Pt, Pt, number, number][] = []
  for (let i = 0; i < ps.length - 1; i++) edges.push([ps[i], ps[i + 1], i, i + 1])
  if (closed && ps.length > 2) edges.push([ps[ps.length - 1], ps[0], ps.length - 1, 0])
  for (let i = 0; i < edges.length; i++) {
    for (let j = i + 1; j < edges.length; j++) {
      const [a, b] = [edges[i], edges[j]]
      // Neighbours meet at their shared point.
      if (a[2] === b[3] || a[3] === b[2] || a[2] === b[2] || a[3] === b[3]) continue
      if (segmentsMeet(a[0], a[1], b[0], b[1])) return true
    }
  }
  return false
}

/** Whether an area's outline (its points, not repeating the first) crosses itself. */
export function areaCrossesItself(points: Pt[]): boolean {
  return points.length > 3 && pathCrossesItself(points, true)
}

/** An area's points from its geometry (null: not an area). */
export function areaPoints(geometry: GeoJSON.Geometry): Pt[] | null {
  if (geometry.type !== 'Polygon' || !geometry.coordinates[0]) return null
  return geometry.coordinates[0].slice(0, -1) as Pt[]
}

/** Every position of a geometry (a collection's too), as [lon, lat]. */
export function positionsOf(geometry: GeoJSON.Geometry): Pt[] {
  if (geometry.type === 'GeometryCollection') return geometry.geometries.flatMap(positionsOf)
  const out: Pt[] = []
  const visit = (c: unknown): void => {
    if (Array.isArray(c) && typeof c[0] === 'number') out.push([c[0], c[1] as number])
    else if (Array.isArray(c)) c.forEach(visit)
  }
  visit(geometry.coordinates)
  return out
}

/** A point feature's position, [lon, lat]. */
export function pointOf(feature: { geometry: GeoJSON.Geometry }): Pt {
  return (feature.geometry as GeoJSON.Point).coordinates as Pt
}
