// Fork: what clicking the map does in "My layers": select (and drag a symbol, or
// the points of a line, area or graphic, to move them), place a symbol / picture /
// marker, draw a line, an area or a tactical graphic (by its control points), or
// copy a map feature into the active layer (with its full geometry from the backend).
// This class wires the map's events and keeps what the rest of My layers calls; the
// parts are in tools/: drawing.ts, dragging.ts, resize.ts (Shift + scroll),
// copy.ts, selection.ts.
import { t } from '../../../core/i18n.ts'
import { Map, MapGeoJSONFeature, MapMouseEvent, PointLike } from 'maplibre-gl'
import { LayerSpecificationWithZIndex } from '../../../../style/types.ts'
import { Store } from '../state/store.ts'
import { Renderer } from './render.ts'
import { withNewColour } from './new-colour.ts'
import { mapMode } from '../../../services/map-mode.ts'
import { MODE } from './tools.constants.ts'
import type { Dragging, Resizing, Tool, ToolsContext } from './tools.types.ts'
import {
  addPoint,
  cancelDrawing,
  drawDraft,
  drawGhost,
  drawing,
  finishDrawing,
  takeBackPoint
} from './tools/drawing.ts'
import { dragTo, endDrag, hoverCursor, startDrag } from './tools/dragging.ts'
import { keepResize, onWheel } from './tools/resize.ts'
import { copyAt } from './tools/copy.ts'
import * as selecting from './tools/selection.ts'

export type { Tool } from './tools.types.ts'
// Also used on their own (and tested): from here, as before.
export { dropRepeats, graphicGeometry } from './tools/drawing.ts'
export { wheelPixels } from './tools/resize.ts'

export class Tools implements ToolsContext {
  tool: Tool = { mode: 'select' }
  selected: string | null = null
  others: string[] = []
  /** Off while a past version is shown (a situation, the history), or while another
   * tool has the map (measuring: ui/map-mode.ts). */
  get enabled(): boolean {
    return this.store.view.live && (!mapMode.current || mapMode.current === MODE)
  }
  message = ''
  hint = ''
  readonly map: Map
  readonly store: Store
  readonly renderer: Renderer
  readonly primaryLayers: () => LayerSpecificationWithZIndex[]
  dragging: Dragging | null = null
  resizing: Resizing | null = null
  cursor: [number, number] | null = null
  wheelTotal = 0
  private listeners: (() => void)[] = []
  // The last click My layers took (decided before it changes the tool).
  private captured: Event | null = null

  constructor(
    map: Map,
    store: Store,
    renderer: Renderer,
    primaryLayers: () => LayerSpecificationWithZIndex[]
  ) {
    this.map = map
    this.store = store
    this.renderer = renderer
    this.primaryLayers = primaryLayers
    map.on('click', (e) => void this.click(e))
    map.on('dblclick', (e) => {
      if (drawing(this.tool)) {
        e.preventDefault()
        this.finishDrawing()
      }
    })
    map.on('mousemove', (e) => this.mousemove(e))
    // Shift + scroll while placing or drawing an arrow: its size, not the zoom (before
    // the map's own wheel handling, which it then doesn't reach).
    map.getContainer().addEventListener('wheel', (e) => onWheel(this, e), { capture: true, passive: false })
    // Off the map: no preview, no line to the cursor.
    map.on('mouseout', () => {
      drawGhost(this, null)
      drawDraft(this)
    })
    map.on('mousedown', (e) => {
      keepResize(this)
      startDrag(this, e)
    })
    map.on('mouseup', () => endDrag(this))
    document.addEventListener('keydown', (e) => this.keydown(e))
  }

  onChange(listener: () => void) {
    this.listeners.push(listener)
  }

  notify() {
    for (const listener of this.listeners) listener()
  }

  setTool(tool: Tool, message = '') {
    keepResize(this)
    this.tool = tool
    this.message = message
    this.hint = message
    this.renderer.draft([], false)
    this.renderer.graphicDraft(null)
    drawGhost(this, null)
    // A tool other than select has the map (another one, like measuring, stops);
    // when it's taken back (Esc, measuring started), select again.
    if (tool.mode === 'select') mapMode.leave(MODE)
    else
      mapMode.enter({
        name: MODE,
        cursor: 'crosshair',
        doubleClickZoom: !drawing(tool),
        // Its own keys (keydown below) stop the tool on Escape.
        keydown: (e) => e.key === 'Escape',
        contextmenu: () => cancelDrawing(this),
        exit: () => {
          if (this.tool.mode !== 'select') this.setTool({ mode: 'select' })
        }
      })
    this.notify()
  }

  select(featureId: string | null) {
    selecting.setSelection(this, featureId ? [featureId] : [])
  }

  /** Add an item to the selection, or take it out (Shift-click). */
  toggle(featureId: string) {
    selecting.toggleSelected(this, featureId)
  }

  /** Select these items (the first is the main one). */
  selectAll(ids: string[]) {
    selecting.setSelection(this, ids)
  }

  /** After a change: drop what no longer exists, draw the rest again. */
  refreshSelection() {
    selecting.refreshSelection(this)
  }

  /** Everything selected, the main one first. */
  selection(): string[] {
    return selecting.selection(this)
  }

  /** Delete everything selected (not what's in a locked layer), as one undo step. */
  deleteSelected() {
    selecting.deleteSelected(this)
  }

  finishDrawing() {
    finishDrawing(this)
  }

  /** The active layer, made if there's none yet. */
  activeLayer(): string {
    const active = this.store.activeLayer ? this.store.layers.get(this.store.activeLayer) : undefined
    if (active && this.store.view.canEdit(active)) return active.id
    // A locked layer takes nothing new: draw into another one, or a new one.
    const open = [...this.store.layers.values()].find((l) => this.store.view.canEdit(l))
    if (open) {
      this.store.setActive(open.id)
      return open.id
    }
    return this.store.createLayer(t('userlayers.default-name', 'My layer'))
  }

  /** My layers' feature under a point, if any. */
  hit(point: PointLike): MapGeoJSONFeature | undefined {
    return selecting.hit(this, point)
  }

  /** Whether a click is for My layers, so upstream's popups should ignore it. */
  capturesClick(e: MapMouseEvent): boolean {
    if (!this.enabled) return false
    return e.originalEvent === this.captured || this.tool.mode !== 'select' || this.hit(e.point) !== undefined
  }

  private async click(e: MapMouseEvent) {
    if (!this.enabled) return
    // This runs before upstream's click router, which asks capturesClick().
    if (this.capturesClick(e)) this.captured = e.originalEvent
    const lngLat: [number, number] = [e.lngLat.lng, e.lngLat.lat]
    switch (this.tool.mode) {
      case 'place': {
        const id = this.store.addFeature(
          this.activeLayer(),
          { type: 'Point', coordinates: lngLat },
          { ...withNewColour(this.tool.properties) }
        )
        this.setTool({ mode: 'select' })
        this.select(id)
        break
      }
      case 'line':
      case 'area':
      case 'graphic':
        addPoint(this, lngLat)
        break
      case 'copy':
        await copyAt(this, e)
        break
      case 'select': {
        const hit = this.hit(e.point)
        // Shift-click adds to (or takes out of) the selection.
        if (hit && e.originalEvent.shiftKey) this.toggle(String(hit.properties.fid))
        else this.select(hit ? String(hit.properties.fid) : null)
        break
      }
    }
  }

  private mousemove(e: MapMouseEvent) {
    this.cursor = [e.lngLat.lng, e.lngLat.lat]
    if (this.tool.mode !== 'select') this.map.getCanvas().style.cursor = 'crosshair'
    if (drawing(this.tool)) drawDraft(this, [e.lngLat.lng, e.lngLat.lat])
    else if (this.tool.mode === 'place') drawGhost(this, [e.lngLat.lng, e.lngLat.lat])
    else if (!this.dragging && this.selected) hoverCursor(this, e)
    dragTo(this, e)
  }

  private keydown(e: KeyboardEvent) {
    if (!this.enabled) return
    const target = e.target as HTMLElement
    if (target.closest('input, textarea, select')) return
    if (e.key === 'Escape') {
      if (this.tool.mode !== 'select') this.setTool({ mode: 'select' })
      else this.select(null)
    } else if (e.key === 'Enter') {
      this.finishDrawing()
    } else if (e.key === 'Backspace' && takeBackPoint(this)) {
      // Took back the last point.
    } else if ((e.key === 'Delete' || e.key === 'Backspace') && this.selected) {
      this.deleteSelected()
    }
  }
}
