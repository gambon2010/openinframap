// Fork: My layers' map tools (tools.ts): copying the map feature under a click (a
// line, a substation, a site...) into the active layer, with its full geometry from
// the backend; once per layer. A building (the Buildings layer, switched on) is
// copied as an ordinary area: its outline, joined from the tiles it's cut into.
import type { MapGeoJSONFeature, MapMouseEvent } from 'maplibre-gl'
import { t } from '../../../../core/i18n.ts'
import { sourceGeometry } from '../../../../core/map-data.ts'
import { buildingId, buildingOutline, isBuildingLayer } from '../../../../core/buildings.ts'
import { withNewColour } from '../new-colour.ts'
import type { FeatureProps } from '../../model/model.ts'
import type { ToolsContext } from '../tools.types.ts'

export async function copyAt(c: ToolsContext, e: MapMouseEvent) {
  // The topmost map feature (upstream's or the fork's data layers) under the click.
  const order = new globalThis.Map(c.primaryLayers().map((l) => [l.id, l.zorder]))
  const candidates = c.map
    .queryRenderedFeatures([
      [e.point.x - 4, e.point.y - 4],
      [e.point.x + 4, e.point.y + 4]
    ])
    .filter((f) => order.has(f.layer.id) && f.sourceLayer && !f.layer.id.startsWith('user_'))
    .sort((a, b) => (order.get(b.layer.id) ?? 0) - (order.get(a.layer.id) ?? 0))
  const f = candidates[0]
  if (!f) {
    c.message = t(
      'userlayers.copy.nothing-buildings',
      'Nothing to copy there: click a line, a substation, a site... (buildings: switch on Buildings, zoom 15 or closer)'
    )
    c.notify()
    return
  }
  await copyFeature(c, f)
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
  c.message = t('userlayers.copy.done', 'Copied. Click more features to copy them, or Esc to stop.')
  c.select(featureId)
  return 'copied'
}

/** A building as an ordinary area of the active layer (editable, the colour for
 * new items), named "Building", with its height kept. */
function copyBuilding(c: ToolsContext, f: MapGeoJSONFeature): 'copied' | 'already' {
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
  const geometry = (id !== undefined && buildingOutline(c.map, id)) || f.geometry
  const properties: FeatureProps = {
    kind: 'drawing',
    name: t('userlayers.copy.building', 'Building'),
    ...(id !== undefined ? { building_id: id } : {}),
    ...(typeof f.properties.height === 'number' ? { height: f.properties.height } : {})
  }
  const featureId = c.store.addFeature(layerId, geometry, withNewColour(properties))
  c.message = t('userlayers.copy.done', 'Copied. Click more features to copy them, or Esc to stop.')
  c.select(featureId)
  return 'copied'
}
