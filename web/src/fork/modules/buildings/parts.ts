// Fork: buildings mapped with parts (towers, wings, a dome: OpenStreetMap's
// building:part), for the 3D view (look.ts). The outer building usually carries the
// tallest height: raised, it would hide its parts in a box. So its parts rise, each
// from where it starts to its own height, and the building is left out. The map's
// data doesn't say which building has parts: they're found here, in the loaded
// tiles, as the buildings with a part inside. A building cut over several tiles has
// the same id in each: found in one, it's left out everywhere.
import booleanPointInPolygon from '@turf/boolean-point-in-polygon'
import type { Map } from 'maplibre-gl'
import { BUILDINGS_SOURCE, BUILDINGS_SOURCE_LAYER, PART_FILTER } from '../../core/buildings.ts'

export interface Shape {
  id: number
  geometry: GeoJSON.Polygon | GeoJSON.MultiPolygon
}

type Box = [west: number, south: number, east: number, north: number]

function boxOf(geometry: GeoJSON.Polygon | GeoJSON.MultiPolygon): Box {
  const box: Box = [Infinity, Infinity, -Infinity, -Infinity]
  const rings =
    geometry.type === 'Polygon' ? [geometry.coordinates[0]] : geometry.coordinates.map((p) => p[0])
  for (const ring of rings)
    for (const [x, y] of ring) {
      box[0] = Math.min(box[0], x)
      box[1] = Math.min(box[1], y)
      box[2] = Math.max(box[2], x)
      box[3] = Math.max(box[3], y)
    }
  return box
}

/** A point standing for a part: the middle of its bounding box (its corners often lie
 * on the building's own edge, where "inside" can't be told). */
function middleOf(part: Shape): [number, number] {
  const [west, south, east, north] = boxOf(part.geometry)
  return [(west + east) / 2, (south + north) / 2]
}

const inBox = ([x, y]: [number, number], [west, south, east, north]: Box) =>
  x >= west && x <= east && y >= south && y <= north

/** The buildings (by id) that have one of the parts inside them. */
export function buildingsWithParts(buildings: Shape[], parts: Shape[]): Set<number> {
  const boxed = buildings.map((building) => ({ building, box: boxOf(building.geometry) }))
  const found = new Set<number>()
  for (const part of parts) {
    const point = middleOf(part)
    for (const { building, box } of boxed) {
      if (found.has(building.id) || !inBox(point, box)) continue
      if (booleanPointInPolygon(point, building.geometry)) found.add(building.id)
    }
  }
  return found
}

function loaded(map: Map, kind: 'building' | 'building_part'): Shape[] {
  const shapes: Shape[] = []
  const features = map.querySourceFeatures(BUILDINGS_SOURCE, {
    sourceLayer: BUILDINGS_SOURCE_LAYER,
    filter: kind === 'building' ? ['==', ['get', 'kind'], 'building'] : PART_FILTER
  })
  for (const f of features) {
    const geometry = f.geometry
    if (typeof f.id === 'number' && (geometry.type === 'Polygon' || geometry.type === 'MultiPolygon'))
      shapes.push({ id: f.id, geometry })
  }
  return shapes
}

/** Finds the buildings with parts in the tiles loaded, adding them to `withParts`;
 * true if it found new ones. Parts already looked at are skipped: when there's no
 * new part, the buildings aren't read at all. */
export function findBuildingsWithParts(map: Map, withParts: Set<number>, partsSeen: Set<number>): boolean {
  const parts = loaded(map, 'building_part').filter((part) => !partsSeen.has(part.id))
  if (!parts.length) return false
  for (const part of parts) partsSeen.add(part.id)
  const before = withParts.size
  for (const id of buildingsWithParts(loaded(map, 'building'), parts)) withParts.add(id)
  return withParts.size > before
}
