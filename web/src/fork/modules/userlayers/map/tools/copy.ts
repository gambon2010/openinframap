// Fork: My layers' map tools (tools.ts): copying the map feature under a click (a
// line, a substation, a site...) into the active layer, with its full geometry from
// the backend; once per layer.
import type { MapMouseEvent } from 'maplibre-gl'
import { t } from '../../../../core/i18n.ts'
import { sourceGeometry } from '../../../../core/map-data.ts'
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
    c.message = t('userlayers.copy.nothing', 'Nothing to copy there: click a line, a substation, a site...')
    c.notify()
    return
  }
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
      return
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
}
