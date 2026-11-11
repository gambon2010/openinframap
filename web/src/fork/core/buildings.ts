// Fork: buildings from the background map (Protomaps' "buildings" layer), shared by
// the buildings module (their outlines, a layer to switch on) and My layers' copy
// tool (a building copied as an area). Only zoom 15 tiles hold every building
// (lower zooms keep a few landmarks), so outlines show from 15.
import polygonClipping, { type MultiPolygon, type Polygon } from 'polygon-clipping'
import type { Map, MapGeoJSONFeature } from 'maplibre-gl'

/** The outlines' map layer (modules/buildings). */
export const BUILDINGS_LAYER = 'buildings_outline'
export const BUILDINGS_SOURCE = 'basemap'
export const BUILDINGS_SOURCE_LAYER = 'buildings'
/** Every building is in the tiles from this zoom. */
export const BUILDINGS_MINZOOM = 15

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

/** A building's whole outline, from every loaded tile that holds a piece of it. */
export function buildingOutline(map: Map, id: number): GeoJSON.Polygon | GeoJSON.MultiPolygon | null {
  const pieces = map
    .querySourceFeatures(BUILDINGS_SOURCE, { sourceLayer: BUILDINGS_SOURCE_LAYER })
    .filter((f) => f.id === id)
    .map((f) => f.geometry)
  return joinPieces(pieces)
}
