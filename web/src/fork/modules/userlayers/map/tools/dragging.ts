// Fork: My layers' map tools (tools.ts): dragging the selected item: the whole of
// it, one of its points (a line's, an area's, a graphic's control points, an
// arrow's width), or a picture's resize handle; shown as it moves, saved as one
// change on release.
import type { MapMouseEvent } from 'maplibre-gl'
import { kindOf } from '../../kinds/index.ts'
import { areaCrossesItself, areaPoints, pointOf } from '../../model/shapes.ts'
import { axisWidthFrom, squareUp } from '../../graphics/graphics.ts'
import { controlPoints, moveVertex, sizeFromDrag, translateGeometry } from '../geometry.ts'
import { graphicGeometry } from './drawing.ts'
import type { ToolsContext } from '../tools.types.ts'

/** A selection handle (resize or point) under the pointer, if any. */
export function handleAt(c: ToolsContext, point: { x: number; y: number }, layer: string) {
  if (!c.map.getLayer(layer)) return undefined
  return c.map.queryRenderedFeatures(
    [
      [point.x - 7, point.y - 7],
      [point.x + 7, point.y + 7]
    ],
    { layers: [layer] }
  )[0]
}

/** Mouse down on the selected item, one of its handles, or its resize handle. */
export function startDrag(c: ToolsContext, e: MapMouseEvent) {
  if (!c.enabled || c.tool.mode !== 'select' || !c.selected) return
  const layer = c.store.layerOf(c.selected)
  const feature = layer?.features.get(c.selected)
  if (
    !layer ||
    !feature ||
    kindOf(feature.properties).movable === false ||
    !c.store.view.canEditItem(layer, feature)
  )
    return
  // The resize handle of a picture, symbol or marker.
  if (handleAt(c, e.point, 'user_selection_resize')) {
    const box = c.renderer.iconBox(feature)
    if (box) {
      e.preventDefault()
      c.map.dragPan.disable()
      const centre = c.map.project(pointOf(feature))
      c.dragging = {
        feature: structuredClone(feature),
        layerId: layer.id,
        resize: { x: centre.x, y: centre.y, distanceAtSize1: Math.hypot(box.right, box.bottom) }
      }
      return
    }
  }
  // A point handle of the selected line, area or graphic.
  const handle = c.map.getLayer('user_selection_vertex')
    ? c.map.queryRenderedFeatures(
        [
          [e.point.x - 6, e.point.y - 6],
          [e.point.x + 6, e.point.y + 6]
        ],
        { layers: ['user_selection_vertex'] }
      )[0]
    : undefined
  if (handle) {
    e.preventDefault()
    c.map.dragPan.disable()
    c.dragging = {
      feature: structuredClone(feature),
      layerId: layer.id,
      index: Number(handle.properties.index)
    }
    return
  }
  const hit = c.hit(e.point)
  if (!hit || String(hit.properties.fid) !== c.selected) return
  e.preventDefault()
  c.map.dragPan.disable()
  // The whole item (grabbed anywhere on it), moved on a copy, saved as one change
  // on mouseup.
  c.dragging = {
    feature: structuredClone(feature),
    layerId: layer.id,
    move: { from: [e.lngLat.lng, e.lngLat.lat], geometry: structuredClone(feature.geometry) }
  }
}

/** Not dragging, something selected: the cursor says what a drag would do. */
export function hoverCursor(c: ToolsContext, e: MapMouseEvent) {
  c.map.getCanvas().style.cursor = handleAt(c, e.point, 'user_selection_resize')
    ? 'nwse-resize'
    : String(c.hit(e.point)?.properties.fid) === c.selected
      ? 'move'
      : ''
}

/** The pointer moving while dragging: the item follows (saved on release). */
export function dragTo(c: ToolsContext, e: MapMouseEvent) {
  if (!c.dragging) return
  const to: [number, number] = [e.lngLat.lng, e.lngLat.lat]
  const { feature, index, resize, move, layerId } = c.dragging
  if (resize) {
    const size = sizeFromDrag(Math.hypot(e.point.x - resize.x, e.point.y - resize.y), resize.distanceAtSize1)
    feature.properties = { ...feature.properties, size }
  } else if (move) {
    feature.geometry = translateGeometry(move.geometry, to[0] - move.from[0], to[1] - move.from[1])
  } else if (kindOf(feature.properties).drawn === 'graphic' && index === -1) {
    // An arrow's size handle: only the width changes.
    const width = axisWidthFrom(controlPoints(feature.geometry), to)
    feature.properties = { ...feature.properties, axisWidth: width }
  } else if (kindOf(feature.properties).drawn === 'graphic') {
    const points = controlPoints(feature.geometry).map((p, i) => (i === index ? to : p))
    feature.geometry = graphicGeometry(squareUp(feature.properties.sidc, points))
  } else if (index !== undefined) {
    const moved = moveVertex(feature.geometry, index, to)
    // An area's point can't go where the outline would cross itself: it stops.
    const ring = areaPoints(moved)
    if (ring && areaCrossesItself(ring)) return
    feature.geometry = moved
  }
  // The item itself follows as it's dragged (saved on mouseup).
  c.renderer.preview(layerId, feature)
  c.renderer.select(feature)
}

/** Released: the change kept (a click without a move isn't one). */
export function endDrag(c: ToolsContext) {
  if (!c.dragging) return
  const { feature, layerId } = c.dragging
  c.dragging = null
  c.map.dragPan.enable()
  const stored = c.store.layers.get(layerId)?.features.get(feature.id)
  const same =
    stored &&
    JSON.stringify(stored.geometry) === JSON.stringify(feature.geometry) &&
    JSON.stringify(stored.properties) === JSON.stringify(feature.properties)
  if (!same) c.store.updateFeature(layerId, feature)
  else c.renderer.preview(layerId, stored)
  c.select(feature.id)
}
