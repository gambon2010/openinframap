// Fork: My layers' map tools (tools.ts): with the copy tool, Shift + drag draws a box
// and everything of the map in it is copied into the active layer at once (copy.ts:
// each once), a whole street's buildings in one go. MapLibre's own Shift + drag zoom
// is off meanwhile (the copy tool's map mode).
import type { MapMouseEvent } from 'maplibre-gl'
import { el } from 'redom'
import { t } from '../../../../core/i18n.ts'
import type { ToolsContext } from '../tools.types.ts'
import { copyFeature, mapFeaturesIn } from './copy.ts'

/** Shift pressed down with the copy tool: the box starts there. */
export function startCopyBox(c: ToolsContext, e: MapMouseEvent) {
  if (c.tool.mode !== 'copy' || !e.originalEvent.shiftKey) return
  e.preventDefault()
  c.map.dragPan.disable()
  const outline = el('.oim-ul-copy-box')
  c.map.getContainer().append(outline)
  c.copyBox = { start: [e.point.x, e.point.y], outline }
  drawBox(c, [e.point.x, e.point.y])
}

/** The box follows the pointer. */
export function dragCopyBox(c: ToolsContext, e: MapMouseEvent) {
  if (c.copyBox) drawBox(c, [e.point.x, e.point.y])
}

/** Released: what's in the box is copied, each once; the message says how many. */
export async function endCopyBox(c: ToolsContext, e: MapMouseEvent) {
  const box = c.copyBox
  if (!box) return
  c.copyBox = null
  box.outline.remove()
  c.map.dragPan.enable()
  const [x0, y0] = box.start
  const features = mapFeaturesIn(c, [
    [Math.min(x0, e.point.x), Math.min(y0, e.point.y)],
    [Math.max(x0, e.point.x), Math.max(y0, e.point.y)]
  ])
  let copied = 0
  // One after the other: each checks what's already in the layer (a building cut into
  // pieces by its tiles comes once).
  for (const feature of features) if ((await copyFeature(c, feature)) === 'copied') copied++
  c.message = t(
    'userlayers.copy.box-done',
    'Copied {{count}} (any already in the layer left as they were).',
    {
      count: copied
    }
  )
  c.notify()
}

function drawBox(c: ToolsContext, [x, y]: [number, number]) {
  const box = c.copyBox
  if (!box) return
  const [x0, y0] = box.start
  Object.assign(box.outline.style, {
    left: `${Math.min(x0, x)}px`,
    top: `${Math.min(y0, y)}px`,
    width: `${Math.abs(x - x0)}px`,
    height: `${Math.abs(y - y0)}px`
  })
}
