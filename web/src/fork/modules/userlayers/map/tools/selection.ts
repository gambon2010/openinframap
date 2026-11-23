// Fork: My layers' map tools (tools.ts): what's selected (one item, or several with
// Shift-click), finding the item under the pointer, deleting the selection.
import type { MapGeoJSONFeature, PointLike } from 'maplibre-gl'
import type { UserFeature } from '../../model/model.ts'
import type { ToolsContext } from '../tools.types.ts'
import { keepResize } from './resize.ts'

/** Select these items (the first is the main one; none: nothing). */
export function setSelection(c: ToolsContext, ids: string[]) {
  keepResize(c)
  c.selected = ids[0] ?? null
  c.others = ids.slice(1)
  drawSelection(c)
  c.notify()
}

/** Add an item to the selection, or take it out (Shift-click). */
export function toggleSelected(c: ToolsContext, featureId: string) {
  const all = c.selection()
  const next = all.includes(featureId) ? all.filter((id) => id !== featureId) : [...all, featureId]
  c.selected = next[0] ?? null
  c.others = next.slice(1)
  drawSelection(c)
  c.notify()
}

/** After a change: drop what no longer exists, draw the rest again. */
export function refreshSelection(c: ToolsContext) {
  const ids = c.selection().filter((id) => c.store.layerOf(id))
  if (!ids.length && !c.selected) return
  c.selected = ids[0] ?? null
  c.others = ids.slice(1)
  drawSelection(c)
  c.notify()
}

/** Everything selected, the main one first. */
export function selection(c: Pick<ToolsContext, 'selected' | 'others'>): string[] {
  return c.selected ? [c.selected, ...c.others.filter((id) => id !== c.selected)] : []
}

function drawSelection(c: ToolsContext) {
  const features = c
    .selection()
    .map((id) => c.store.layerOf(id)?.features.get(id))
    .filter((f): f is UserFeature => Boolean(f))
  c.renderer.selectAll(features)
}

/** My layers' feature under a point, if any. */
export function hit(c: ToolsContext, point: PointLike): MapGeoJSONFeature | undefined {
  const layers = c.renderer.featureLayerIds()
  if (!layers.length) return undefined
  const [x, y] = Array.isArray(point) ? point : [point.x, point.y]
  return c.map.queryRenderedFeatures(
    [
      [x - 5, y - 5],
      [x + 5, y + 5]
    ],
    { layers }
  )[0]
}

/** Delete everything selected (not what's in a locked layer), as one undo step. */
export function deleteSelected(c: ToolsContext) {
  const ids = c.selection().filter((id) => {
    const layer = c.store.layerOf(id)
    return c.store.view.canEditItem(layer, layer?.features.get(id))
  })
  if (ids.length) c.store.deleteFeatures(ids)
  c.select(null)
}
