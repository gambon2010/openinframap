// Fork: My layers' map tools (tools.ts): copying the map feature under a click (a
// line, a substation, a site...) into the active layer, with its full geometry from
// the backend; once per layer. A building (the Buildings layer, switched on) is
// copied as a building item: its outline, joined from the tiles it's cut into.
import type { Map, MapGeoJSONFeature, MapMouseEvent } from 'maplibre-gl'
import { t } from '../../../../core/i18n.ts'
import { OIM_TILES } from '../../../../config.ts'
import { sourceGeometry } from '../../../../core/map-data.ts'
import {
  buildingId,
  buildingNames,
  copiedBuildingName,
  exactOutline,
  isBuildingLayer
} from '../../../../core/buildings.ts'
import { withNewColour } from '../new-colour.ts'
import type { FeatureProps } from '../../model/model.ts'
import type { ToolsContext } from '../tools.types.ts'

export async function copyAt(c: ToolsContext, e: MapMouseEvent) {
  // The topmost map feature under the click.
  const f = mapFeaturesIn(c, [
    [e.point.x - 4, e.point.y - 4],
    [e.point.x + 4, e.point.y + 4]
  ])[0]
  if (!f) {
    c.message = t(
      'userlayers.copy.nothing-buildings',
      'Nothing to copy there: click a line, a substation, a site... (buildings: switch on Buildings, zoom 12 or closer)'
    )
    c.notify()
    return
  }
  await copyFeature(c, f)
}

/** The map features that can be copied in a box on the screen, the topmost first:
 * infrastructure (the tile server's: power, telecoms, water, oil and gas, sites, extra
 * data) and buildings. Not the background map's roads, contours or the like: a copy of
 * them couldn't be renamed or changed on the map, so it would bring nothing. */
export function mapFeaturesIn(
  c: ToolsContext,
  box: [[number, number], [number, number]]
): MapGeoJSONFeature[] {
  const order = new globalThis.Map(c.primaryLayers().map((l) => [l.id, l.zorder]))
  return c.map
    .queryRenderedFeatures(box)
    .filter((f) => order.has(f.layer.id) && f.sourceLayer && !f.layer.id.startsWith('user_'))
    .filter((f) => canCopy(c.map, f))
    .sort((a, b) => (order.get(b.layer.id) ?? 0) - (order.get(a.layer.id) ?? 0))
}

/** Whether a map feature can be copied into a layer: a building, or infrastructure
 * (its source's tiles the tile server's, Tegola). */
export function canCopy(map: Map, feature: MapGeoJSONFeature): boolean {
  return isBuildingLayer(feature.layer.id) || fromInfrastructureTiles(map, feature.source)
}

function fromInfrastructureTiles(map: Map, source: string): boolean {
  const spec = map.getStyle()?.sources?.[source]
  const tiles = spec && 'tiles' in spec ? (spec.tiles ?? []) : []
  return tiles.some((url) => url.startsWith(OIM_TILES))
}

/** A map feature (a line, a substation, a building...) into the active layer, once:
 * from a click with the copy tool, or the details' copy button. */
export async function copyFeature(c: ToolsContext, f: MapGeoJSONFeature): Promise<'copied' | 'already'> {
  if (isBuildingLayer(f.layer.id)) return copyBuilding(c, f)
  const id = Number(f.properties.osm_id ?? f.properties.id)
  const layerId = c.activeLayer()
  const key = `${f.source}/${f.sourceLayer}`
  const layer = c.store.layers.get(layerId)!
  for (const existing of layer.features.values()) {
    const copy = existing.properties.copy
    if (
      copy &&
      `${copy.source}/${copy.sourceLayer}` === key &&
      Number(existing.properties.osm_id ?? existing.properties.id) === id
    ) {
      c.message = t('userlayers.copy.already', 'Already in this layer.')
      c.select(existing.id)
      return 'already'
    }
  }
  let geometry: GeoJSON.Geometry = f.geometry
  if (f.geometry.type !== 'Point' && Number.isFinite(id)) {
    geometry = (await sourceGeometry(f.sourceLayer!, id)) ?? f.geometry
  }
  const properties: FeatureProps = {
    ...(f.properties as Record<string, unknown>),
    kind: 'copy',
    copy: { source: f.source, sourceLayer: f.sourceLayer!, layer: f.layer.id }
  }
  const featureId = c.store.addFeature(layerId, geometry, properties)
  c.message = t('userlayers.copy.done', 'Copied. Click more, Shift + drag a box for many, or Esc to stop.')
  c.select(featureId)
  return 'copied'
}

/** A building into the active layer (kinds/building.ts: its shape fixed, the colour
 * for new items), named by its number, with its height kept. */
async function copyBuilding(c: ToolsContext, f: MapGeoJSONFeature): Promise<'copied' | 'already'> {
  const id = buildingId(f)
  const layerId = c.activeLayer()
  const layer = c.store.layers.get(layerId)!
  for (const existing of layer.features.values()) {
    if (id !== undefined && existing.properties.building_id === id) {
      c.message = t('userlayers.copy.already', 'Already in this layer.')
      c.select(existing.id)
      return 'already'
    }
  }
  const [outline, names] = await Promise.all([exactOutline(c.map, f), buildingNames(f)])
  const geometry = outline || f.geometry
  const name = copiedBuildingName(names)
  const properties: FeatureProps = {
    kind: 'building',
    // Its own name and number ("Cathédrale Notre-Dame · STR-CAT-3"): the number the
    // same on everyone's map.
    ...(name ? { name } : {}),
    ...(id !== undefined ? { building_id: id } : {}),
    ...(typeof f.properties.height === 'number' ? { height: f.properties.height } : {})
  }
  const featureId = c.store.addFeature(layerId, geometry, withNewColour(properties))
  c.message = t('userlayers.copy.done', 'Copied. Click more, Shift + drag a box for many, or Esc to stop.')
  c.select(featureId)
  return 'copied'
}
