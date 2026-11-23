// Fork: My layers' map tools (tools.ts): Shift + scroll: the item being placed
// bigger or smaller, the arrow being drawn wider or narrower, or the selected
// marker, symbol, picture or arrow resized (kept as one change once the scrolling
// stops).
import { t } from '../../../../core/i18n.ts'
import { clamp } from '../../../../core/math.ts'
import { kindOf } from '../../kinds/index.ts'
import { axisWidth } from '../../graphics/graphics.ts'
import type { UserFeature } from '../../model/model.ts'
import { MAX_SIZE, MIN_SIZE } from '../render.constants.ts'
import { controlPoints } from '../geometry.ts'
import {
  WHEEL_LINE_PX,
  WHEEL_NOTCH,
  WHEEL_PAGE_PX,
  WHEEL_STEP_FACTOR,
  WIDTH_FACTOR_MAX,
  WIDTH_FACTOR_MIN
} from '../tools.constants.ts'
import type { ToolsContext } from '../tools.types.ts'
import { drawDraft, drawGhost } from './drawing.ts'

// Shift + scroll: a size in fine steps (0.01), unlike the handle's drag (0.05).
const clampSize = (size: number) => clamp(Math.round(size * 100) / 100, MIN_SIZE, MAX_SIZE)

/** How far a wheel event scrolled, in pixels (Shift turns it sideways in most
 * browsers, so either axis). */
export function wheelPixels(e: Pick<WheelEvent, 'deltaX' | 'deltaY' | 'deltaMode'>): number {
  const raw = e.deltaY || e.deltaX
  return raw * (e.deltaMode === 1 ? WHEEL_LINE_PX : e.deltaMode === 2 ? WHEEL_PAGE_PX : 1)
}

/** Shift + scroll (a notch: 10 %). */
export function onWheel(c: ToolsContext, e: WheelEvent) {
  if (!e.shiftKey || !c.enabled) return
  const placing = c.tool.mode === 'place' && kindOf(c.tool.properties).sized
  const arrow = c.tool.mode === 'graphic' && c.tool.axis
  const editing = c.tool.mode === 'select' && resizable(c) !== null
  if (!placing && !arrow && !editing) return
  e.preventDefault()
  e.stopPropagation()
  c.wheelTotal += wheelPixels(e)
  const steps = Math.trunc(c.wheelTotal / WHEEL_NOTCH)
  if (!steps) return
  c.wheelTotal -= steps * WHEEL_NOTCH
  const factor = WHEEL_STEP_FACTOR ** -steps // wheel up (negative): bigger
  if (editing) resizeSelected(c, factor)
  else if (c.tool.mode === 'place') {
    const size = clampSize((c.tool.properties.size ?? 1) * factor)
    c.tool.properties = { ...c.tool.properties, size }
    c.message = `${c.hint} ${t('userlayers.size-now', 'Size: {{n}} %', { n: Math.round(size * 100) })}`
    drawGhost(c, c.cursor)
  } else if (c.tool.mode === 'graphic') {
    const widthFactor = clamp((c.tool.widthFactor ?? 1) * factor, WIDTH_FACTOR_MIN, WIDTH_FACTOR_MAX)
    c.tool.widthFactor = widthFactor
    c.message = `${c.hint} ${t('userlayers.width-now', 'Width: {{n}} %', { n: Math.round(widthFactor * 100) })}`
    drawDraft(c, c.cursor ?? undefined)
  }
  c.notify()
}

/** The selected item, if Shift + scroll can resize it: one item, that may be
 * changed, with a size (a marker, a symbol, a picture) or an arrow's width. */
export function resizable(c: ToolsContext): { layerId: string; feature: UserFeature } | null {
  if (!c.selected || c.others.length) return null
  const layer = c.store.layerOf(c.selected)
  const feature = layer?.features.get(c.selected)
  if (!layer || !feature || !c.store.view.canEditItem(layer, feature)) return null
  const p = feature.properties
  const sized = kindOf(p).sized && feature.geometry.type === 'Point'
  if (!sized && !(p.axis || p.axisWidth !== undefined)) return null
  return { layerId: layer.id, feature }
}

function resizeSelected(c: ToolsContext, factor: number) {
  const target = resizable(c)
  if (!target) return
  const feature = structuredClone(
    c.resizing?.feature.id === target.feature.id ? c.resizing.feature : target.feature
  )
  const p = feature.properties
  if (kindOf(p).sized && feature.geometry.type === 'Point') {
    const size = clampSize((p.size ?? 1) * factor)
    feature.properties = { ...p, size }
    c.message = t('userlayers.size-now', 'Size: {{n}} %', { n: Math.round(size * 100) })
  } else {
    const width = Math.max(
      10,
      Math.round((p.axisWidth ?? axisWidth(controlPoints(feature.geometry))) * factor)
    )
    feature.properties = { ...p, axisWidth: width }
    c.message = t('userlayers.width-metres', 'Width: {{n}} m', { n: width })
  }
  c.notify()
  c.renderer.preview(target.layerId, feature)
  c.renderer.select(feature)
  if (c.resizing) clearTimeout(c.resizing.timer)
  c.resizing = { layerId: target.layerId, feature, timer: setTimeout(() => keepResize(c), 500) }
}

/** The resize so far, kept (one change). */
export function keepResize(c: ToolsContext) {
  const resizing = c.resizing
  if (!resizing) return
  clearTimeout(resizing.timer)
  c.resizing = null
  c.message = c.hint
  c.store.updateFeature(resizing.layerId, resizing.feature)
  c.notify()
}
