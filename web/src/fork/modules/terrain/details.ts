// Fork: a clicked thing's height in its details ("Elevation 312 m"), from the
// terrain (services/elevation.ts): a point's own; an area's at its middle; none for a
// line (its heights are a profile: the line of sight planned, docs/plans/terrain.md).
import type { MapGeoJSONFeature } from 'maplibre-gl'
import type { Geometry, Polygon, MultiPolygon, Position } from 'geojson'
import booleanPointInPolygon from '@turf/boolean-point-in-polygon'
import { el } from 'redom'
import { t } from '../../core/i18n.ts'
import { formatHeight, groundAt } from '../../services/elevation.ts'

export type HeightPlace = { lng: number; lat: number; middle: boolean }

/** Where a thing's height is read: a point itself; an area the middle of its box when
 * that's inside it (not in a ring's hole, nor beside a crescent); otherwise none. */
export function heightPlace(geometry: Geometry): HeightPlace | null {
  if (geometry.type === 'Point')
    return { lng: geometry.coordinates[0], lat: geometry.coordinates[1], middle: false }
  if (geometry.type !== 'Polygon' && geometry.type !== 'MultiPolygon') return null
  const [lng, lat] = boxMiddle(geometry)
  return booleanPointInPolygon([lng, lat], geometry) ? { lng, lat, middle: true } : null
}

function boxMiddle(area: Polygon | MultiPolygon): Position {
  const points = (area.type === 'Polygon' ? [area.coordinates] : area.coordinates).flat(2)
  const lngs = points.map((p) => p[0])
  const lats = points.map((p) => p[1])
  return [(Math.min(...lngs) + Math.max(...lngs)) / 2, (Math.min(...lats) + Math.max(...lats)) / 2]
}

/** Adds the height as a row of the details' table, once the backend answers (nothing
 * where there's no terrain, or the details were closed meanwhile). */
export async function heightRow(feature: MapGeoJSONFeature, content: HTMLElement) {
  const place = heightPlace(feature.geometry)
  if (!place) return
  const metres = (await groundAt(place.lng, place.lat)).elevation
  const table = content.querySelector('table.item_info')
  if (metres === null || !table || !content.isConnected) return
  const label = place.middle
    ? t('terrain.elevation-middle', 'Elevation (middle)')
    : t('terrain.elevation', 'Elevation')
  table.append(el('tr', el('th', label), el('td', formatHeight(metres))))
}
