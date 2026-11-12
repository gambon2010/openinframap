// Fork: buildings from the background map (Protomaps' "buildings" layer), shared by
// the buildings module (their outlines, a layer to switch on) and My layers' copy
// tool (a building copied as an area). Only zoom 15 tiles hold every building
// (lower zooms keep a few landmarks): from 15 the background map's own tiles are
// drawn; zoomed out (12 to 14), the large ones, found once by a build step
// (web-backend/src/fork/background/large_buildings.py) and served by Tegola. A copy
// takes the exact outline from the backend either way (exactOutline).
import polygonClipping, { type MultiPolygon, type Polygon } from 'polygon-clipping'
import type { Map, MapGeoJSONFeature } from 'maplibre-gl'
import { groundArea } from './geo.ts'

/** The outlines' map layer (modules/buildings); its clickable inside is `<id>_hit`. */
export const BUILDINGS_LAYER = 'buildings_outline'
/** Every buildings layer's id starts with this (the layer switcher's prefix too). */
export const BUILDINGS_PREFIX = 'buildings_'

/** Whether a map layer is one of the buildings' (outlines, insides, zoomed out or not). */
export const isBuildingLayer = (id: string) => id.startsWith(BUILDINGS_PREFIX)
export const BUILDINGS_SOURCE = 'basemap'
export const BUILDINGS_SOURCE_LAYER = 'buildings'
/** Every building is in the tiles from this zoom. */
export const BUILDINGS_MINZOOM = 15
/** Large buildings zoomed out (Tegola's "buildings" map): from this zoom, each zoom
 * those big enough to see there. */
export const LARGE_BUILDINGS_LAYER = 'buildings_large'
export const LARGE_BUILDINGS_MINZOOM = 12

/** A building's id: the same in every tile it's cut into (Protomaps' own, not
 * OpenStreetMap's number). */
export function buildingId(feature: Pick<MapGeoJSONFeature, 'id'>): number | undefined {
  return typeof feature.id === 'number' ? feature.id : undefined
}

/** One outline from the pieces of a building cut at tile edges (each tile holds
 * its own piece, with a little overlap): their union. */
export function joinPieces(pieces: GeoJSON.Geometry[]): GeoJSON.Polygon | GeoJSON.MultiPolygon | null {
  const polygons: (Polygon | MultiPolygon)[] = []
  for (const g of pieces) {
    if (g.type === 'Polygon') polygons.push(g.coordinates as Polygon)
    else if (g.type === 'MultiPolygon') polygons.push(g.coordinates as MultiPolygon)
  }
  if (!polygons.length) return null
  const joined =
    polygons.length === 1 ? toMulti(polygons[0]) : polygonClipping.union(polygons[0], ...polygons.slice(1))
  if (!joined.length) return null
  return joined.length === 1
    ? { type: 'Polygon', coordinates: joined[0] }
    : { type: 'MultiPolygon', coordinates: joined }
}

function toMulti(p: Polygon | MultiPolygon): MultiPolygon {
  return typeof p[0][0][0] === 'number' ? [p as Polygon] : (p as MultiPolygon)
}

/** A building's whole outline, from every loaded tile of its source (the
 * background map, or the large buildings zoomed out) that holds a piece of it. */
export function buildingOutline(
  map: Map,
  feature: Pick<MapGeoJSONFeature, 'id' | 'source' | 'sourceLayer'>
): GeoJSON.Polygon | GeoJSON.MultiPolygon | null {
  const id = buildingId(feature)
  if (id === undefined) return null
  const pieces = map
    .querySourceFeatures(feature.source ?? BUILDINGS_SOURCE, {
      sourceLayer: feature.sourceLayer ?? BUILDINGS_SOURCE_LAYER
    })
    .filter((f) => f.id === id)
    .map((f) => f.geometry)
  return joinPieces(pieces)
}

/** Square metres inside an outline (holes, such as courtyards, taken out). */
export function outlineArea(outline: GeoJSON.Polygon | GeoJSON.MultiPolygon): number {
  const polygons = outline.type === 'Polygon' ? [outline.coordinates] : outline.coordinates
  let total = 0
  for (const [outer, ...holes] of polygons) {
    total += groundArea(outer as [number, number][])
    for (const hole of holes) total -= groundArea(hole as [number, number][])
  }
  return total
}

/** A point of a feature's geometry (its first), to say where it is. */
function somePoint(g: GeoJSON.Geometry): [number, number] | null {
  if (g.type === 'Polygon') return g.coordinates[0]?.[0] as [number, number]
  if (g.type === 'MultiPolygon') return g.coordinates[0]?.[0]?.[0] as [number, number]
  return null
}

/**
 * A building's exact outline: the backend joins its pieces from the background
 * map's zoom 15 tiles, whatever zoom it was clicked at (zoomed out, the tiles'
 * shapes are simplified). The pieces on screen if the backend can't say.
 */
export async function exactOutline(
  map: Map,
  feature: Pick<MapGeoJSONFeature, 'id' | 'source' | 'sourceLayer' | 'geometry'>
): Promise<GeoJSON.Polygon | GeoJSON.MultiPolygon | null> {
  const id = buildingId(feature)
  const at = somePoint(feature.geometry)
  if (id !== undefined && at) {
    try {
      const query = new URLSearchParams({ lon: String(at[0]), lat: String(at[1]) })
      const response = await fetch(`/background/building/${id}?${query}`)
      if (response.ok) return (await response.json()).geometry
    } catch {
      // Offline from the backend: what's on screen.
    }
  }
  return buildingOutline(map, feature)
}
