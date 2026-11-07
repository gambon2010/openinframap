// Fork: My layers' map tools (tools.ts): drawing a line, an area or a tactical
// graphic one click at a time, its draft as it grows, finishing it; and the faint
// preview of what a placing tool would put down.
import { t } from '../../../../core/i18n.ts'
import { axisWidth, squareUp } from '../../graphics/graphics.ts'
import { areaCrossesItself, pathCrossesItself } from '../../model/shapes.ts'
import { newItemColour, withNewColour } from '../new-colour.ts'
import { iconName } from '../icons.ts'
import { CLOSE_PX, MIN_SEPARATION_PX, REPEAT_PX } from '../tools.constants.ts'
import type { DrawingTool, Tool, ToolsContext } from '../tools.types.ts'

/** Modes that add points one click at a time. */
export function drawing(tool: Tool): tool is DrawingTool {
  return tool.mode === 'line' || tool.mode === 'area' || tool.mode === 'graphic'
}

/** A graphic's control points as a geometry (a line through them, or one point). */
export function graphicGeometry(points: [number, number][]): GeoJSON.Geometry {
  return points.length > 1
    ? { type: 'LineString', coordinates: points }
    : { type: 'MultiPoint', coordinates: points }
}

/** Points of a drawing, without the repeats a double-click adds. */
export function dropRepeats(points: [number, number][]): [number, number][] {
  return points.filter((p, i, all) => i === 0 || p[0] !== all[i - 1][0] || p[1] !== all[i - 1][1])
}

const CROSSING = () => t('userlayers.area-crossing', "Not there: the area's outline would cross itself.")

/** A click while drawing: a point more (or the area closed, or a point refused). */
export function addPoint(c: ToolsContext, lngLat: [number, number]) {
  const tool = c.tool
  if (tool.mode === 'graphic') {
    tool.points.push(lngLat)
    drawDraft(c, lngLat)
    // Graphics with a fixed number of points (block, breach...) finish by themselves.
    if (tool.points.length >= tool.max) finishDrawing(c)
    else c.notify()
    return
  }
  if (tool.mode !== 'line' && tool.mode !== 'area') return
  // A click on an area's first point closes it.
  if (tool.mode === 'area' && tool.points.length >= 3 && nearFirst(c, lngLat)) {
    finishDrawing(c)
    return
  }
  // Not on top of another of an area's points: the second click of a
  // double-click is let go quietly, one a little further off refused.
  if (tool.mode === 'area' && tool.points.length) {
    const near = nearestPx(c, lngLat)
    if (near <= REPEAT_PX) return
    if (near < MIN_SEPARATION_PX) {
      c.message = t('userlayers.area-too-close', 'Too close to another point of the area.')
      c.notify()
      return
    }
  }
  // An area's outline mustn't cross itself (model/shapes.ts).
  if (tool.mode === 'area' && pathCrossesItself([...tool.points, lngLat])) {
    c.message = CROSSING()
    c.notify()
    return
  }
  tool.points.push(lngLat)
  drawDraft(c)
  if (c.message !== c.hint) {
    c.message = c.hint
    c.notify()
  }
}

/** How far (pixels) a point is from the nearest point drawn so far. */
function nearestPx(c: ToolsContext, lngLat: [number, number]): number {
  if (!drawing(c.tool)) return Infinity
  const b = c.map.project(lngLat)
  return Math.min(
    ...c.tool.points.map((p) => {
      const a = c.map.project(p)
      return Math.hypot(a.x - b.x, a.y - b.y)
    })
  )
}

/** Whether a point is on the first point of the area being drawn (a few pixels). */
function nearFirst(c: ToolsContext, lngLat: [number, number]): boolean {
  if (!drawing(c.tool) || !c.tool.points.length) return false
  const a = c.map.project(c.tool.points[0])
  const b = c.map.project(lngLat)
  return Math.hypot(a.x - b.x, a.y - b.y) <= CLOSE_PX
}

export function finishDrawing(c: ToolsContext) {
  const tool = c.tool
  if (!drawing(tool)) return
  // A double-click adds the same point twice.
  let points = dropRepeats(tool.points)
  // An area finished on its first point: that's where it closes anyway.
  if (tool.mode === 'area' && points.length > 3 && nearFirst(c, points[points.length - 1])) {
    points = points.slice(0, -1)
  }
  if (tool.mode === 'graphic') {
    if (points.length < tool.min) {
      c.message = t('userlayers.graphic-more', 'This graphic needs at least {{n}} points.', {
        n: tool.min
      })
      c.notify()
      return
    }
    const properties = tool.axis
      ? {
          ...tool.properties,
          axis: true,
          axisWidth: Math.max(10, Math.round(axisWidth(points) * (tool.widthFactor ?? 1)))
        }
      : tool.properties
    const id = c.store.addFeature(
      c.activeLayer(),
      graphicGeometry(squareUp(properties.sidc, points)),
      withNewColour(properties)
    )
    c.setTool({ mode: 'select' })
    c.select(id)
    return
  }
  const area = tool.mode === 'area'
  if (area && areaCrossesItself(points)) {
    // Closing it would cross: a point more (or one taken back) first.
    c.message = t(
      'userlayers.area-crossing-close',
      'Closing the area here would make it cross itself: add a point elsewhere, or take one back (Backspace).'
    )
    c.notify()
    return
  }
  if (points.length >= (area ? 3 : 2)) {
    const geometry: GeoJSON.Geometry = area
      ? { type: 'Polygon', coordinates: [[...points, points[0]]] }
      : { type: 'LineString', coordinates: points }
    const id = c.store.addFeature(
      c.activeLayer(),
      geometry,
      withNewColour(tool.properties ?? { kind: 'drawing' })
    )
    c.setTool({ mode: 'select' })
    c.select(id)
  } else {
    c.setTool({ mode: 'select' })
  }
}

/** Backspace while drawing: the last point taken back. */
export function takeBackPoint(c: ToolsContext): boolean {
  if (!drawing(c.tool) || !c.tool.points.length) return false
  c.tool.points.pop()
  drawDraft(c)
  c.notify()
  return true
}

/** The line or area being drawn; a measurement: with its lengths so far, to the cursor. */
export function drawDraft(c: ToolsContext, cursor?: [number, number]) {
  const tool = c.tool
  if (!drawing(tool)) return
  if (tool.mode === 'graphic') {
    // As it will look once done, faint, once it has enough points for a shape
    // (an arrow: two); until then the points and a line to the cursor.
    const points = cursor ? [...tool.points, cursor] : tool.points
    const needed = tool.axis ? 2 : Math.max(2, tool.min)
    if (points.length >= needed && tool.properties.sidc) {
      c.renderer.draft(tool.points, false, undefined, false)
      c.renderer.graphicDraft({
        sidc: tool.properties.sidc,
        points: squareUp(tool.properties.sidc, points),
        axis: tool.axis,
        widthFactor: tool.widthFactor,
        colour: tool.properties.color ?? newItemColour()
      })
    } else {
      c.renderer.graphicDraft(null)
      c.renderer.draft(tool.points, false, cursor)
    }
    return
  }
  // On to where the next point would go (an area: and back to its start).
  const area = tool.mode === 'area'
  if (tool.properties?.kind === 'measure') {
    const points = cursor && tool.points.length ? [...tool.points, cursor] : tool.points
    c.renderer.measureDraft({ type: area ? 'area' : 'distance', points })
    return
  }
  c.renderer.draft(tool.points, area, cursor)
}

/** A placing tool: what it would put down, faint under the cursor (null: none). */
export function drawGhost(c: ToolsContext, cursor: [number, number] | null) {
  if (c.tool.mode !== 'place' || !cursor) {
    void c.renderer.ghost(null, null)
    // Range rings are previewed as a draft.
    if (c.tool.mode === 'place') c.renderer.draft([], false)
    return
  }
  const p = c.tool.properties
  if (p.kind === 'measure') {
    c.renderer.measureDraft({ type: 'rings', points: [cursor], radii: p.radii as number[] })
    return
  }
  void c.renderer.ghost(iconName(withNewColour(p)), cursor, p.size ?? 1)
}

/** Right-click while drawing: what's drawn so far is dropped; again: the tool stops. */
export function cancelDrawing(c: ToolsContext) {
  if (drawing(c.tool) && c.tool.points.length) {
    c.tool.points = []
    c.renderer.draft([], false)
    c.renderer.graphicDraft(null)
    c.notify()
  } else c.setTool({ mode: 'select' })
}
